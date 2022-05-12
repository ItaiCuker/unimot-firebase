/* eslint-disable valid-jsdoc */
/* eslint-disable max-len */
import * as functions from "firebase-functions";

// firestore db import
import admin = require("firebase-admin");
admin.initializeApp();
const FIREBASE_CONFIG = process.env.FIREBASE_CONFIG && JSON.parse(process.env.FIREBASE_CONFIG);
const projectId = FIREBASE_CONFIG.projectId;
const db = admin.firestore();
const remotesRef = db.collection("remotes");
const devicesRef = db.collection("devices");
const commandsRef = db.collection("commands");

// IoT Core client import
import iot = require("@google-cloud/iot");
const client = new iot.v1.DeviceManagerClient();

/**
 * cloud function to send command to a remote
 */
export const sendCommand = functions.region("europe-west1").runWith({
  minInstances: 1,
  memory: "128MB",
}).https.onCall((req) => {
  console.log("sendCommand: ", req);
  return sendToRemote(req);
});

/**
 * function to send command to remote
 * @param req request to send to remote
 * @returns promise of sendCommandToDevice function
 */
async function sendToRemote(req: any) {
  const formattedName = client.devicePath(
      projectId, // project id
      "europe-west1", // client region
      "remotes", // registry id, my project uses only one.
      req.remoteId // remote id
  );

  // send IR command?
  if (req.message === "send") {
    const command = (await commandsRef.doc(req.commandId).get()).data();

    console.log("remote command =", command);
    req.command = command;
  }

  // parsing JSON to binary buffer.
  const binaryData = Buffer.from(JSON.stringify(req.command));

  const request = {
    name: formattedName,
    binaryData: binaryData,
  };
  console.log("sending command:");
  return new Promise((resolve, reject) => {
    client.sendCommandToDevice( request, (err: unknown, resp: unknown) => {
      if (err) {
        console.log("Could not send command:", req);
        console.log("Error: ", err);
        reject(err);
      } else {
        resolve(resp);
      }
    });
  });
}

/**
 * cloud function to run when an IoT Core device publishes data
 */
exports.onRemotePublish = functions.region("europe-west1").runWith({
  minInstances: 1,
  memory: "128MB",
}).pubsub.topic("remote-data").onPublish(async (message) => {
  const promises: Promise<FirebaseFirestore.WriteResult>[] = []; // array of promises

  const remoteId = message.attributes.deviceId; // remoteId string

  const decodedData = Buffer.from(message.data, "base64").toString();
  const dataJson = JSON.parse(decodedData); // parsing data base64 encoded to JSON.
  console.log("Publish message: {%s,%s}", remoteId, dataJson);

  // create command?
  if (dataJson.state === "create") {
    const commandId: string = dataJson.commandId;
    const commandName: string = dataJson.commandName;

    // creating command doc if commandId is empty string
    const commandRef = !commandId ? commandsRef.doc() : commandsRef.doc(commandId);
    promises.push(commandRef.set(
        {
          commandName: commandName,
          commandLen: dataJson.commandLen,
          command: dataJson.command,
        }
    ));
    // updating device with command and remote state:
    promises.push(devicesRef.doc(dataJson.deviceId).update(`commands.${commandName}`, commandRef.id));
    promises.push(remotesRef.doc(remoteId).update({state: ""}));
  } else {
    // any other publish message will update remote doc
    promises.push(remotesRef.doc(remoteId).update(dataJson));

    // updating all devices linked to remote
    (await updateDevicesStates(dataJson.state === "", remoteId)).forEach((promise) => {
      promises.push(promise);
    });
  }
  return Promise.all(promises);
});

/**
 * cloud function to run periodically to update remotes and devices state.
 */
exports.getRemoteState = functions.region("europe-west1").pubsub.schedule("every 1 minutes").onRun( async () => {
  const promises: Promise<FirebaseFirestore.WriteResult>[] = []; // array of promises
  (await remotesRef.get()).forEach(async (doc) => {
    // getting state remote for every remote in collection
    const remoteId = doc.id;

    let isOnline: boolean;
    const request = {
      remoteId: remoteId,
      command: {alive: "?"},
    };
    try {
      await sendToRemote(request);
      console.log("Assuming device is online after succecfull alive? command");
      isOnline = true;
    } catch (error) {
      console.log("Unable to send alive? command", error);
      isOnline = false;
    }

    // remote doc reference
    const remoteDoc = remotesRef.doc(remoteId);

    // updating isOnline field
    promises.push(remoteDoc.update({isOnline: isOnline}));

    // getting state field from remoteId doc
    const state: string = (await remoteDoc.get()).get("state");
    // assigning isAvailable based these, while checking if state is null:
    const isAvailable = !state && isOnline;

    // updating all devices linked to remote
    (await updateDevicesStates(isAvailable, remoteId)).forEach((promise) => {
      promises.push(promise);
    });
  });
  return Promise.all(promises);
});


/**
 * updates all devices linked to remote
 * @param isAvailable state boolean
 * @param remoteId id of remote
 */
async function updateDevicesStates(isAvailable: boolean, remoteId: string) {
  const promises: Promise<FirebaseFirestore.WriteResult>[] = []; // array of promises
  // updating all Device documents state that are linked to the Remote
  (await devicesRef.where("remoteId", "==", remoteId).get())
      .forEach((deviceSnap) => {
        // updating isAvailable field for all Devices linked to Remote
        promises.push(devicesRef.doc(deviceSnap.id).update({isAvailable: isAvailable}));
      });
  return promises;
}
