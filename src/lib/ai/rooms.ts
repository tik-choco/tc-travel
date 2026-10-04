import { createRoomConsumers } from "@tik-choco/mistai";
import { sharedMistNodeScope } from "../mistNode";

// The scope multiplexes AI consumers, providers and tunnels over the existing
// page node; storage and travel-room collaboration keep their event dispatcher.
export const aiRooms = createRoomConsumers(sharedMistNodeScope, { nodeIdStorageKey: "tc-travel:nodeId" });
