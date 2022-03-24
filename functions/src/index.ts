/* eslint-disable valid-jsdoc */
/* eslint-disable max-len */
import * as functions from "firebase-functions";

import iot = require("@google-cloud/iot");
const client = new iot.v1.DeviceManagerClient();

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
      "esp32-firebase-blink", // project id
      "europe-west1", // cloud region
      "Remotes", // registry id, should get from request
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