"use client";
import React, { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

const socket: Socket = io("http://localhost:3001");

export default function RTCConnection() {
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const receivedChunksRef = useRef<BlobPart[]>([]);
  const fileMetaRef = useRef<{
    name: string;
    size: number;
    type: string;
  } | null>(null);

  const [status, setStatus] = useState("⏳ Waiting for peer...");
  const [progress, setProgress] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("received_file");

  useEffect(() => {
    const peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    peerConnectionRef.current = peerConnection;

    // Handle ICE
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("ice-candidate", event.candidate);
      }
    };

    // Caller creates DataChannel
    const channel = peerConnection.createDataChannel("fileShare");
    dataChannelRef.current = channel;

    channel.onopen = () => {
      setStatus("✅ Data channel open, ready to send files");
    };

    channel.onclose = () => {
      setStatus("❌ Data channel closed");
    };

    // Receiver side: listen for DataChannel
    peerConnection.ondatachannel = (event) => {
      const receiveChannel = event.channel;
      receiveChannel.binaryType = "arraybuffer";

      receiveChannel.onopen = () => {
        setStatus("✅ Data channel open (callee), ready to receive");
      };

      receiveChannel.onmessage = (event) => {
        if (typeof event.data === "string") {
          try {
            const meta = JSON.parse(event.data);
            if (meta.name && meta.size) {
              fileMetaRef.current = meta;
              setFileName(meta.name);
              setProgress(0);
              receivedChunksRef.current = [];
              return;
            }
          } catch {}
          if (event.data === "EOF") {
            const blob = new Blob(receivedChunksRef.current, {
              type: fileMetaRef.current?.type,
            });
            const url = URL.createObjectURL(blob);
            setDownloadUrl(url);
            setStatus("📥 File received!");
            receivedChunksRef.current = [];
            return;
          }
        } else if (event.data instanceof ArrayBuffer) {
          receivedChunksRef.current.push(event.data);
          setProgress((p) => p + event.data.byteLength);
        }
      };
    };

    // Handle offer
    socket.on("offer", async (offer) => {
      if (!peerConnectionRef.current) return;
      await peerConnectionRef.current.setRemoteDescription(
        new RTCSessionDescription(offer)
      );
      const answer = await peerConnectionRef.current.createAnswer();
      await peerConnectionRef.current.setLocalDescription(answer);
      socket.emit("answer", answer);
    });

    // Handle answer
    socket.on("answer", async (answer) => {
      if (!peerConnectionRef.current) return;
      await peerConnectionRef.current.setRemoteDescription(
        new RTCSessionDescription(answer)
      );
    });

    // Handle ICE
    socket.on("ice-candidate", async (candidate) => {
      if (!peerConnectionRef.current) return;
      try {
        await peerConnectionRef.current.addIceCandidate(
          new RTCIceCandidate(candidate)
        );
      } catch (err) {
        console.error("Error adding ICE candidate:", err);
      }
    });

    // Caller starts connection
    const makeOffer = async () => {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      socket.emit("offer", offer);
    };

    makeOffer();

    return () => {
      socket.off("offer");
      socket.off("answer");
      socket.off("ice-candidate");
      peerConnection.close();
    };
  }, []);

  // File sending
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const channel = dataChannelRef.current;
    if (!file || !channel || channel.readyState !== "open") return;

    // Send metadata first
    channel.send(
      JSON.stringify({ name: file.name, size: file.size, type: file.type })
    );

    const chunkSize = 16 * 1024; // 16KB
    let offset = 0;

    while (offset < file.size) {
      const slice = file.slice(offset, offset + chunkSize);
      const buffer = await slice.arrayBuffer();
      channel.send(buffer);
      offset += buffer.byteLength;
      setProgress(offset);
    }

    channel.send("EOF");
    setStatus("📤 File sent!");
  };

  return (
    <div style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>📡 WebRTC File Share (Socket.IO)</h1>
      <p>Status: {status}</p>

      <input type="file" onChange={handleFileChange} />

      <p>Progress: {progress} bytes</p>

      {downloadUrl && (
        <a href={downloadUrl} download={fileName}>
          ⬇️ Download Received File
        </a>
      )}
    </div>
  );
}
