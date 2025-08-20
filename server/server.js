import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

io.on("connection", (socket) => {
  console.log("New Client: ", socket.id);

  socket.on("offer", (data) => {
    console.log("Offer from", socket.id);
    socket.broadcast.emit("offer", data);
  });

  socket.on("answer", (data) => {
    console.log("Answer from", socket.id);
    socket.broadcast.emit("answer", data);
  });

  socket.on("ice-candidate", (candidate) => {
    console.log("Candidate from", socket.id);
    socket.broadcast.emit("ice-candidate", candidate);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

server.listen(3001, () => {
  console.log("🚀 Signaling server running at http://localhost:3001");
});
