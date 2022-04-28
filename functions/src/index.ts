/* eslint-disable valid-jsdoc */
/* eslint-disable max-len */
import * as functions from "firebase-functions";

import iot = require("@google-cloud/iot");
const client = new iot.v1.DeviceManagerClient();

export const listDeviceStates = functions.region("europe-west1").runWith({
  minInstances: 1,
  memory: "128MB",
}).https.onCall(() => {
  listDevices();
});

/**
 * Cloud function to list all devices in cloud iot registry
 */
async function listDevices() {
  // Construct request
  const formattedName = client.registryPath(
      await client.getProjectId(), // project id
      "europe-west1", // client region
      "remotes" // registry id, my project uses only one.
  );


  const [response] = await client.listDevices({
    parent: formattedName,
  });
  const devices = response;

  if (devices.length > 0) {
    console.log("Current devices in registry:");
  } else {
    console.log("No devices in registry.");
  }

  for (let i = 0; i < devices.length; i++) {
    const device = devices[i];
    console.log(`Device ${i}: `, device);
  }
}

/**
 * cloud function to send IR command to a device
 */
export const sendCommand = functions.region("europe-west1").runWith({
  minInstances: 1,
  memory: "128MB",
}).https.onCall((data) => {
  const deviceId = data.deviceId; // id that client sent
  const command = data.command; // command that client sent
  console.log("deviceId: %s \t command %s", deviceId, command);

  // checking for invalid arguments:

  if (!(typeof command === "string") || command.length === 0 || !(typeof deviceId === "string") || deviceId.length === 0) {
    // Throwing an HttpsError so that the client gets the error details.
    throw new functions.https.HttpsError("invalid-argument", "The function recieved invalid arguments");
  }

  // sending command if no errors
  return sendToDevice(deviceId, command);
});

/**
 *
 * @param deviceId device id to send command to
 * @param command command to send to device
 * @returns reponse of function
 */
async function sendToDevice(deviceId:string, command:string) {
  const formattedName = client.devicePath(
      await client.getProjectId(), // project id
      "europe-west1", // client region
      "remotes", // registry id, my project uses only one.
      deviceId // device id
  );

  const binaryData = Buffer.from(command); // parsing command string data to binary buffer

  const request = {
    name: formattedName,
    binaryData: binaryData,
  };
  console.log("sending command:");
  const [response] = await client.sendCommandToDevice(request);
  console.log("Sent command: ", (response) ? "succesful" : response);
  return response;
}

/**
 * cloud function to run when a device publishes to pubsub topic "remote-data"
 */
exports.devicePublish = functions.region("europe-west1").runWith({
  minInstances: 1,
  memory: "128MB",
}).pubsub.topic("remote-data").onPublish((message) => {
  console.log("Publish message: ", message.attributes, Buffer.from(message.data, "base64"));
});
