import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { io } from "socket.io-client";
import './App.css';

// ========== FIXED: Use direct connection to backend ==========
const socket = io("http://localhost:5000", {
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});

// Create axios instance with direct URL
const api = axios.create({
  baseURL: "http://localhost:5000", // Direct connection
  timeout: 30000,
});

export default function App() {
  const [userName, setUserName] = useState("");
  const [showNamePopup, setShowNamePopup] = useState(true);
  const [inputName, setInputName] = useState("");
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [typers, setTypers] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  
  const socketRef = useRef(null);
  const typingTimer = useRef(null);
  const audioChunks = useRef([]);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);

  // Test backend connection on mount
  useEffect(() => {
    const testConnection = async () => {
      try {
        const response = await fetch("http://localhost:5000/");
        const data = await response.json();
        console.log("✅ Backend is running:", data);
      } catch (error) {
        console.error("❌ Backend not reachable:", error);
        alert("Backend server not running. Please start backend first (npm start in backend folder)");
      }
    };
    
    testConnection();
  }, []);

  // Initialize socket
  useEffect(() => {
    socketRef.current = socket;

    // Connection status handlers
    socketRef.current.on("connect", () => {
      console.log("✅ Connected to server:", socketRef.current.id);
      console.log("✅ Socket connected:", socketRef.current.connected);
      setConnectionStatus("connected");
    });

    socketRef.current.on("connect_error", (error) => {
      console.error("❌ Connection error:", error.message);
      setConnectionStatus("error");
      console.log("Please check if backend is running at http://localhost:5000");
    });

    socketRef.current.on("disconnect", (reason) => {
      console.log("❌ Disconnected:", reason);
      setConnectionStatus("disconnected");
    });

    // Chat event handlers
    socketRef.current.on("chatMessage", (msg) => {
      console.log("📨 New message:", msg);
      setMessages(prev => [...prev, msg]);
    });

    socketRef.current.on("previousMessages", (msgs) => {
      console.log("📥 Received previous messages:", msgs.length);
      if (msgs.length > 0) {
        console.log("Last message:", msgs[msgs.length - 1]);
      }
      setMessages(msgs);
    });

    socketRef.current.on("typing", (data) => {
      console.log("⌨️ Typing:", data.userName);
      setTypers(prev => {
        if (!prev.includes(data.userName)) {
          return [...prev, data.userName];
        }
        return prev;
      });
    });

    socketRef.current.on("stopTyping", (data) => {
      console.log("💤 Stopped typing:", data.userName);
      setTypers(prev => prev.filter(name => name !== data.userName));
    });

    socketRef.current.on("onlineUsers", (users) => {
      console.log("👥 Online users:", users.length);
      setOnlineUsers(users);
    });

    socketRef.current.on("error", (error) => {
      console.error("Socket error:", error);
    });

    // Cleanup
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Typing indicator
  useEffect(() => {
    if (!userName || !text.trim()) {
      if (typingTimer.current) {
        clearTimeout(typingTimer.current);
      }
      return;
    }

    socketRef.current.emit("typing", { userName, room: "group" });

    if (typingTimer.current) {
      clearTimeout(typingTimer.current);
    }

    typingTimer.current = setTimeout(() => {
      socketRef.current.emit("stopTyping", { userName, room: "group" });
    }, 1000);

    return () => {
      if (typingTimer.current) {
        clearTimeout(typingTimer.current);
      }
    };
  }, [text, userName]);

  // Handle name submission
  const handleNameSubmit = (e) => {
    e.preventDefault();
    const trimmed = inputName.trim();
    if (!trimmed) {
      alert("Please enter a name");
      return;
    }
    
    setUserName(trimmed);
    socketRef.current.emit("joinRoom", { 
      userName: trimmed, 
      room: "group" 
    });
    setShowNamePopup(false);
    console.log(`👋 User ${trimmed} joining chat`);
  };

  // Send message
  const sendMessage = (type = "text", content = null) => {
    try {
      const messageText = type === "text" ? text.trim() : content;
      if (!messageText) {
        console.log("No content to send");
        return;
      }

      const message = {
        sender: userName,
        text: messageText,
        type,
        room: "group",
        ts: new Date()
      };

      console.log("📤 Sending message:", type, messageText.substring(0, 50));
      socketRef.current.emit("chatMessage", message);
      
      // Add to local state for instant feedback
      setMessages(prev => [...prev, {
        ...message,
        _id: `temp-${Date.now()}`
      }]);
      
      if (type === "text") {
        setText("");
      }
    } catch (error) {
      console.error("Error sending message:", error);
      alert("Failed to send message");
    }
  };

  // Handle Enter key
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // IMAGE UPLOAD - WORKING VERSION
  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) {
      console.log("No file selected");
      return;
    }

    // Basic validation
    if (!file.type.startsWith('image/')) {
      alert("Please select an image file (JPEG, PNG, GIF, etc.)");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      alert("Image must be less than 5MB");
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append("image", file);

    try {
      console.log("📤 Uploading image:", file.name, file.type, `${(file.size / 1024).toFixed(2)}KB`);
      
      const response = await api.post("/upload", formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        },
        timeout: 30000
      });

      console.log("✅ Upload success:", response.data);
      
      if (response.data && response.data.url) {
        sendMessage("image", response.data.url);
      } else {
        throw new Error("No URL in response");
      }
    } catch (error) {
      console.error("❌ Upload failed:");
      console.error("Error:", error.message);
      if (error.response) {
        console.error("Response status:", error.response.status);
        console.error("Response data:", error.response.data);
        alert(`Upload failed: ${error.response.data?.error || error.response.statusText}`);
      } else if (error.request) {
        console.error("No response received");
        alert("Upload failed: No response from server. Is backend running?");
      } else {
        alert(`Upload failed: ${error.message}`);
      }
    } finally {
      setUploading(false);
      e.target.value = ""; // Reset file input
    }
  };

  // AUDIO RECORDING - WORKING VERSION
  const startRecording = async () => {
    try {
      console.log("🎤 Requesting microphone access...");
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100
        }
      });
      
      mediaStreamRef.current = stream;
      
      // Create MediaRecorder with fallback MIME type
      let options = {};
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        options = { mimeType: 'audio/webm;codecs=opus' };
      } else if (MediaRecorder.isTypeSupported('audio/webm')) {
        options = { mimeType: 'audio/webm' };
      }
      
      mediaRecorderRef.current = new MediaRecorder(stream, options);
      audioChunks.current = [];
      
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.current.push(event.data);
        }
      };
      
      mediaRecorderRef.current.onstop = async () => {
        console.log("⏹️ Recording stopped, processing audio...");
        
        if (audioChunks.current.length === 0) {
          console.log("No audio data recorded");
          return;
        }
        
        const audioBlob = new Blob(audioChunks.current, { 
          type: mediaRecorderRef.current.mimeType || 'audio/webm' 
        });
        
        console.log("Audio blob size:", `${(audioBlob.size / 1024).toFixed(2)}KB`);
        
        setUploading(true);
        const formData = new FormData();
        formData.append("audio", audioBlob, "recording.webm");
        
        try {
          console.log("📤 Uploading audio...");
          const response = await api.post("/upload-audio", formData, {
            headers: {
              'Content-Type': 'multipart/form-data'
            },
            timeout: 30000
          });
          
          console.log("✅ Audio upload success:", response.data);
          
          if (response.data && response.data.url) {
            sendMessage("audio", response.data.url);
          } else {
            throw new Error("No URL in response");
          }
        } catch (error) {
          console.error("❌ Audio upload failed:");
          console.error("Error:", error.message);
          if (error.response) {
            alert(`Audio upload failed: ${error.response.data?.error || error.response.statusText}`);
          } else if (error.request) {
            alert("Audio upload failed: No response from server");
          } else {
            alert(`Audio upload failed: ${error.message}`);
          }
        } finally {
          setUploading(false);
          audioChunks.current = [];
          
          // Clean up media stream
          if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
          }
        }
      };
      
      mediaRecorderRef.current.start();
      setRecording(true);
      console.log("🔴 Recording started...");
      
    } catch (error) {
      console.error("❌ Recording error:", error);
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        alert("Microphone access was denied. Please allow microphone access in your browser settings.");
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        alert("No microphone found. Please connect a microphone and try again.");
      } else {
        alert(`Could not access microphone: ${error.message}`);
      }
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
      console.log("🛑 Recording stopped");
    }
  };

  // Format time
  const formatTime = (ts) => {
    const date = new Date(ts);
    return date.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    });
  };

  // Download file helper
  const downloadFile = (url, filename) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-4 font-sans">
      {showNamePopup && (
        <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 mx-4">
            <div className="text-center mb-6">
              <div className="text-4xl mb-2">💬</div>
              <h1 className="text-2xl font-bold text-gray-800">Welcome to Chat</h1>
              <p className="text-gray-600 mt-2">Enter your name to start chatting</p>
            </div>
            <form onSubmit={handleNameSubmit} className="space-y-4">
              <input
                autoFocus
                value={inputName}
                onChange={(e) => setInputName(e.target.value)}
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 outline-none focus:border-green-500 transition-colors text-center text-lg"
                placeholder="Your name"
                maxLength={20}
              />
              <button 
                type="submit" 
                className="w-full px-4 py-3 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 text-white font-semibold hover:opacity-90 transition-opacity"
              >
                Join Chat
              </button>
            </form>
          </div>
        </div>
      )}

      {!showNamePopup && (
        <div className="max-w-4xl mx-auto h-[calc(100vh-2rem)] bg-white rounded-2xl shadow-xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-green-50 to-emerald-50">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-gradient-to-r from-green-500 to-emerald-600 flex items-center justify-center text-white font-bold text-lg shadow-md">
                C
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-800">Realtime Chat</h1>
                <div className="text-sm text-gray-600">
                  {typers.length > 0 ? (
                    <span className="text-green-600 font-medium animate-pulse">
                      {typers.join(", ")} {typers.length === 1 ? 'is' : 'are'} typing...
                    </span>
                  ) : onlineUsers.length > 0 ? (
                    <span>{onlineUsers.length} user{onlineUsers.length !== 1 ? 's' : ''} online • {messages.length} messages</span>
                  ) : (
                    <span>Connecting to chat...</span>
                  )}
                </div>
              </div>
            </div>
            
            <div className="text-right">
              <div className="text-sm font-medium text-gray-800 bg-green-100 px-3 py-1 rounded-full">
                {userName}
              </div>
              <div className={`text-xs mt-1 flex items-center justify-end gap-1 ${
                connectionStatus === "connected" ? "text-green-600" : 
                connectionStatus === "error" ? "text-red-600" : "text-yellow-600"
              }`}>
                <div className={`w-2 h-2 rounded-full ${
                  connectionStatus === "connected" ? "bg-green-500 animate-pulse" : 
                  connectionStatus === "error" ? "bg-red-500" : "bg-yellow-500"
                }`}></div>
                {connectionStatus === "connected" ? "Connected" : 
                 connectionStatus === "error" ? "Connection Error" : "Disconnected"}
              </div>
            </div>
          </div>

          {/* Messages Container */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gradient-to-b from-gray-50 to-white">
            {messages.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-400">
                <div className="text-center">
                  <div className="text-6xl mb-4">👋</div>
                  <p className="text-lg">No messages yet</p>
                  <p className="text-sm">Start the conversation!</p>
                </div>
              </div>
            ) : (
              messages.map((msg, index) => {
                const isMine = msg.sender === userName;
                const isTemp = msg._id?.startsWith('temp-');
                
                return (
                  <div 
                    key={msg._id || `msg-${index}`} 
                    className={`flex ${isMine ? "justify-end" : "justify-start"} ${isTemp ? "opacity-80" : ""}`}
                  >
                    <div className={`max-w-[80%] ${isMine ? "order-2" : "order-1"}`}>
                      {!isMine && (
                        <div className="text-xs font-medium text-gray-600 mb-1 ml-2">
                          {msg.sender}
                        </div>
                      )}
                      
                      <div className={`rounded-2xl px-4 py-3 ${
                        isMine 
                          ? "bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-br-none" 
                          : "bg-gray-100 text-gray-800 rounded-bl-none"
                      } ${isTemp ? "border-2 border-dashed border-gray-300" : ""}`}>
                        {msg.type === "image" && (
                          <div className="space-y-2">
                            <img 
                              src={msg.text} 
                              alt="Uploaded" 
                              className="max-w-full h-auto rounded-lg max-h-64 object-contain bg-gray-200"
                              onError={(e) => {
                                e.target.src = "https://via.placeholder.com/300x200?text=Image+Error";
                              }}
                            />
                            <button
                              onClick={() => downloadFile(msg.text, `image-${Date.now()}.jpg`)}
                              className="text-xs bg-black/10 hover:bg-black/20 px-2 py-1 rounded"
                            >
                              Download
                            </button>
                          </div>
                        )}
                        
                        {msg.type === "audio" && (
                          <div className="space-y-2">
                            <audio 
                              controls 
                              src={msg.text}
                              className="w-full min-w-[200px]"
                              onError={(e) => {
                                console.error("Audio load error:", e);
                                e.target.parentElement.innerHTML = `
                                  <div class="text-center p-4 bg-red-50 rounded">
                                    <p class="text-red-600">Failed to load audio</p>
                                    <a href="${msg.text}" target="_blank" class="text-blue-500 underline">Open in new tab</a>
                                  </div>
                                `;
                              }}
                            />
                            <button
                              onClick={() => downloadFile(msg.text, `audio-${Date.now()}.webm`)}
                              className="text-xs bg-black/10 hover:bg-black/20 px-2 py-1 rounded"
                            >
                              Download Audio
                            </button>
                          </div>
                        )}
                        
                        {msg.type === "text" && (
                          <div className="whitespace-pre-wrap break-words">{msg.text}</div>
                        )}
                      </div>
                      
                      <div className={`text-[10px] text-gray-500 mt-1 flex justify-between items-center ${
                        isMine ? "flex-row-reverse mr-2" : "ml-2"
                      }`}>
                        <span>{formatTime(msg.ts)}</span>
                        {isTemp && <span className="text-xs text-gray-400">Sending...</span>}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Input Area */}
          <div className="border-t border-gray-200 bg-white p-4">
            {uploading && (
              <div className="mb-2 text-center">
                <div className="inline-flex items-center gap-2 bg-blue-100 text-blue-700 px-4 py-2 rounded-full text-sm">
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-700"></div>
                  {recording ? "Processing audio..." : "Uploading..."}
                </div>
              </div>
            )}
            
            <div className="flex items-end gap-2">
              <div className="flex-1 relative">
                <textarea
                  rows={1}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type your message..."
                  className="w-full resize-none outline-none border border-gray-300 rounded-xl px-4 py-3 pr-24 text-sm focus:border-green-500 transition-colors max-h-32 bg-gray-50"
                  disabled={uploading || recording}
                />
                <div className="absolute right-2 bottom-2 text-xs text-gray-500">
                  {text.length}/1000
                </div>
              </div>
              
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Image Upload */}
                <input 
                  type="file" 
                  accept="image/*,.jpg,.jpeg,.png,.gif,.webp" 
                  onChange={handleImageUpload} 
                  className="hidden" 
                  id="imageUpload"
                  disabled={uploading || recording}
                />
                <label 
                  htmlFor="imageUpload" 
                  className={`cursor-pointer p-3 rounded-full transition-all ${
                    uploading || recording
                      ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                      : "bg-blue-500 text-white hover:bg-blue-600 active:scale-95"
                  }`}
                  title="Upload image"
                >
                  📷
                </label>
                
                {/* Audio Recording */}
                {!recording ? (
                  <button 
                    onClick={startRecording}
                    disabled={uploading}
                    className={`p-3 rounded-full transition-all ${
                      uploading
                        ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                        : "bg-red-500 text-white hover:bg-red-600 active:scale-95"
                    }`}
                    title="Record audio message"
                  >
                    🎤
                  </button>
                ) : (
                  <button 
                    onClick={stopRecording}
                    className="bg-gray-600 text-white p-3 rounded-full animate-pulse hover:bg-gray-700 transition-colors active:scale-95"
                    title="Stop recording"
                  >
                    ⏹️
                  </button>
                )}
                
                {/* Send Button */}
                <button 
                  onClick={() => sendMessage()}
                  disabled={!text.trim() || uploading}
                  className={`px-6 py-3 rounded-xl font-medium transition-all ${
                    !text.trim() || uploading
                      ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                      : "bg-gradient-to-r from-green-500 to-emerald-600 text-white hover:opacity-90 active:scale-95"
                  }`}
                >
                  Send
                </button>
              </div>
            </div>
            
            {/* Status Bar */}
            <div className="flex justify-between items-center mt-2 text-xs text-gray-500">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${
                  connectionStatus === "connected" ? "bg-green-500 animate-pulse" : 
                  connectionStatus === "error" ? "bg-red-500" : "bg-yellow-500"
                }`}></div>
                <span>
                  {connectionStatus === "connected" ? "Connected to server" : 
                   connectionStatus === "error" ? "Connection error" : "Disconnected"}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span>Press Enter to send</span>
                <span>Shift+Enter for new line</span>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Debug info */}
      {process.env.NODE_ENV === 'development' && (
        <div className="fixed bottom-2 left-2 bg-black/80 text-white text-xs p-2 rounded opacity-50 hover:opacity-100 transition-opacity">
          <div>Status: {connectionStatus}</div>
          <div>Messages: {messages.length}</div>
          <div>Typers: {typers.length}</div>
          <div>Online: {onlineUsers.length}</div>
          {socketRef.current?.id && (
            <div>Socket: {socketRef.current.id.substring(0, 8)}...</div>
          )}
        </div>
      )}
    </div>
  );
}