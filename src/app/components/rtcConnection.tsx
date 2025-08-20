"use client";
import React, { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

const socket: Socket = io("http://localhost:3001");

export default function RTCConnection() {
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const fileMetaRef = useRef<{
    name: string;
    size: number;
    type: string;
  } | null>(null);

  const [status, setStatus] = useState("⏳ Waiting for peer...");
  const [progress, setProgress] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("received_file");

  // Writer for streaming received file
  const fileWriterRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(
    null
  );
  const receivedBytesRef = useRef<number>(0);

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

      receiveChannel.onmessage = async (event) => {
        if (typeof event.data === "string") {
          try {
            const meta = JSON.parse(event.data);
            if (meta.name && meta.size) {
              fileMetaRef.current = meta;
              setFileName(meta.name);
              setProgress(0);
              receivedBytesRef.current = 0;

              // Try File System Access API (if available)
              if ((window as any).showSaveFilePicker) {
                const handle = await (window as any).showSaveFilePicker({
                  suggestedName: meta.name,
                  types: [
                    {
                      description: meta.type,
                      accept: {
                        [meta.type]: [`.${meta.name.split(".").pop()}`],
                      },
                    },
                  ],
                });
                const writable = await handle.createWritable();
                const stream = new WritableStream({
                  async write(chunk) {
                    await writable.write(chunk);
                  },
                  async close() {
                    await writable.close();
                    setStatus("📥 File saved to disk!");
                  },
                });
                fileWriterRef.current = stream.getWriter();
              } else {
                // Fallback: keep chunks in memory
                const chunks: BlobPart[] = [];
                const stream = new WritableStream({
                  write(chunk) {
                    chunks.push(chunk);
                  },
                  close() {
                    const blob = new Blob(chunks, { type: meta.type });
                    const url = URL.createObjectURL(blob);
                    setDownloadUrl(url);
                    setStatus("📥 File ready to download!");
                  },
                });
                fileWriterRef.current = stream.getWriter();
              }

              return;
            }
          } catch {}
          if (event.data === "EOF") {
            await fileWriterRef.current?.close();
            fileWriterRef.current = null;
            return;
          }
        } else if (event.data instanceof ArrayBuffer) {
          if (fileWriterRef.current && fileMetaRef.current) {
            await fileWriterRef.current.write(new Uint8Array(event.data));
            receivedBytesRef.current += event.data.byteLength;
            const percent = Math.round(
              (receivedBytesRef.current / fileMetaRef.current.size) * 100
            );
            setProgress(percent);
          }
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
      // Backpressure: wait if bufferedAmount is too high
      while (channel.bufferedAmount > 16 * chunkSize) {
        await new Promise((r) => setTimeout(r, 50));
      }

      const slice = file.slice(offset, offset + chunkSize);
      const buffer = await slice.arrayBuffer();
      channel.send(buffer);
      offset += buffer.byteLength;

      setProgress(Math.round((offset / file.size) * 100));
    }

    channel.send("EOF");
    setStatus("📤 File sent!");
  };

  return (
    <div style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>📡 WebRTC File Share (Socket.IO)</h1>
      <p>Status: {status}</p>

      <input type="file" onChange={handleFileChange} />

      <p>Progress: {progress}%</p>

      {downloadUrl && (
        <a href={downloadUrl} download={fileName}>
          ⬇️ Download Received File
        </a>
      )}
    </div>
  );
}
