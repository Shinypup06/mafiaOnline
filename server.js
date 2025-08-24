const PHASES = {
  WAITING: "waiting",
  NIGHT: "night",
  DAY: "day",
  ENDED: "ended"
};

const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "public")));

const lobbies = new Map(); // code -> { code, host, players:[{id,name,role,alive}], state }
const socketToCode = new Map(); // socket.id -> lobby code

function generateUniqueCode() {
  for (let tries = 0; tries < 50; tries++) {
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    if (!lobbies.has(code)) return code;
  }
  throw new Error("Could not generate unique code");
}

function broadcastLobby(code) {
  const lobby = lobbies.get(code);
  if (!lobby) return;
  io.to(code).emit("lobby:update", {
    code: lobby.code,
    host: lobby.host,
    state: lobby.state,
    players: lobby.players.map(p => ({ id: p.id, name: p.name, alive: p.alive })),
  });
}

function removePlayer(socket) {
  const code = socketToCode.get(socket.id);
  if (!code) return;
  const lobby = lobbies.get(code);
  if (!lobby) return;

  lobby.players = lobby.players.filter(p => p.id !== socket.id);

  // Reassign host if needed
  if (lobby.host === socket.id) lobby.host = lobby.players[0]?.id || null;

  // Delete empty lobby
  if (lobby.players.length === 0) lobbies.delete(code);
  else broadcastLobby(code);

  socket.leave(code);
  socketToCode.delete(socket.id);
}

function assignRoles(players) {
  const n = players.length;
  const roles = Array(n).fill("Villager");

  // Determine number of Mafias
  let mafiaCount = n > 7 ? 2 : 1;
  let detectiveCount = 1;
  let doctorCount = 1;
  let jesterCount = 1;

  const idxs = [...players.keys()].sort(() => Math.random() - 0.5);

  // Assign Mafias
  for (let i = 0; i < mafiaCount; i++) roles[idxs[i]] = "Mafia";
  for (let i = mafiaCount; i < mafiaCount + detectiveCount; i++) roles[idxs[i]] = "Detective";
  for (let i = mafiaCount + detectiveCount; i < mafiaCount + detectiveCount + doctorCount; i++) roles[idxs[i]] = "Doctor";
  for (let i = mafiaCount + detectiveCount + doctorCount; i < mafiaCount + detectiveCount + doctorCount + jesterCount; i++) roles[idxs[i]] = "Jester";

  players.forEach((p, i) => { p.role = roles[i]; p.alive = true; });
}

function checkWinCondition(lobby) {
  if (!lobby) return false;

  const alivePlayers = lobby.players.filter(p => p.alive);
  const mafiaCount = alivePlayers.filter(p => p.role === "Mafia").length;
  const villagerCount = alivePlayers.filter(p => p.role !== "Mafia" && p.role !== "Jester").length;

  if (mafiaCount >= villagerCount && mafiaCount > 0) {
    io.to(lobby.code).emit("chat:msg", { from: "System", text: "Mafia wins!" });
    lobby.state = PHASES.ENDED;
    broadcastLobby(lobby.code);
    return true;
  }

  if (mafiaCount === 0) {
    io.to(lobby.code).emit("chat:msg", { from: "System", text: "Villagers win!" });
    lobby.state = PHASES.ENDED;
    broadcastLobby(lobby.code);
    return true;
  }

  return false;
}

io.on("connection", socket => {

  // -------------------------
  // Lobby events
  // -------------------------
  socket.on("lobby:create", ({ name }) => {
    const code = generateUniqueCode();
    const lobby = {
      code,
      host: socket.id,
      players: [],
      state: PHASES.WAITING,
      actions: { mafiaTarget: null, doctorSave: null, detectiveCheck: null, votes: {} }
    };
    lobbies.set(code, lobby);

    socket.join(code);
    socketToCode.set(socket.id, code);
    lobby.players.push({ id: socket.id, name: name?.trim() || "Host", alive: true });

    socket.emit("lobby:created", { code });
    broadcastLobby(code);
  });

  socket.on("lobby:join", ({ code, name }) => {
    code = String(code || "").trim();
    const lobby = lobbies.get(code);
    if (!lobby) return socket.emit("error:msg", "Lobby not found.");
    if (lobby.players.some(p => p.id === socket.id)) return;
    if (lobby.state !== PHASES.WAITING) return socket.emit("error:msg", "Game already started.");

    socket.join(code);
    socketToCode.set(socket.id, code);
    lobby.players.push({ id: socket.id, name: name?.trim() || "Player", alive: true });

    broadcastLobby(code);
  });

  socket.on("lobby:leave", () => removePlayer(socket));

  // -------------------------
  // Chat messages
  // -------------------------

function canChat(player, lobby) {
  if (!player.alive) return false; // dead = no chat
  if (lobby.state === "day") return true; // everyone alive can chat in the day
  if (lobby.state === "night") {
    if (player.role === "mafia") {
      // Mafia can chat with other mafia at night if >1 mafia
      const mafias = lobby.players.filter(p => p.role === "mafia" && p.alive);
      return mafias.length > 1;
    }
    return false; // non-mafia blocked at night
  }
  return true;
}


socket.on("chat:send", ({ text }) => {
  const code = socketToCode.get(socket.id);
  const lobby = lobbies.get(code);
  if (!code || !lobby) return;

  const player = lobby.players.find(p => p.id === socket.id);
  if (!player) {
    socket.emit("chat:msg", { from: "System", text: "Player not found in lobby." });
    return;
  }

    if (!canChat(player, lobby)) {
    socket.emit("chat:msg", { from: "System", text: "You cannot chat right now." });
    return;
  }

  if (!player.alive) {
    socket.emit("chat:msg", { from: "System", text: "You are dead and cannot chat." });
    return;
  }
  if (gamePhase === "night") {
      // Mafia-only chat
      if (player.role === "mafia") {
        // Send only to other mafias
        for (let id in players) {
          if (players[id].role === "mafia" && players[id].alive) {
            io.to(id).emit("chatMessage", {
              sender: player.name,
              message: msg,
              mafiaOnly: true
            });
          }
        }
      }
      // If not mafia, ignore messages at night
    } else {
  io.to(code).emit("chat:msg", {
    from: player.name,
    text: text || ""
  });
    }
});


  // -------------------------
  // Game start
  // -------------------------
  socket.on("game:start", () => {
    const code = socketToCode.get(socket.id);
    const lobby = lobbies.get(code);
    if (!lobby) return;
    if (socket.id !== lobby.host) return socket.emit("error:msg", "Only host can start.");
    if (lobby.players.length < 4) return socket.emit("error:msg", "Need at least 4 players.");

    assignRoles(lobby.players);

    lobby.players.forEach(p => {
      p.alive = true; 
      io.to(p.id).emit("game:role", { role: p.role, code: lobby.code });
      io.to(p.id).emit("chat:msg", { from: "System", text: `You are ${p.role}.` });
    });

    const mafias = lobby.players.filter(p => p.role === "Mafia");
    mafias.forEach(p => {
      const otherMafias = mafias.filter(m => m.id !== p.id).map(m => m.name);
      if (otherMafias.length > 0) {
        io.to(p.id).emit("chat:msg", { from: "System", text: `Other Mafia(s): ${otherMafias.join(", ")}` });
      }
    });

    broadcastLobby(code);

    setTimeout(() => startNightDayCycle(lobby), 100);

    // -------------------------
    function startNightDayCycle(lobby) {
      if (!lobby) return;

      // Resolve votes from previous day
      if (lobby.state === PHASES.DAY) {
        const voteCounts = {};
        Object.values(lobby.actions.votes).forEach(targetId => {
          if (!voteCounts[targetId]) voteCounts[targetId] = 0;
          voteCounts[targetId]++;
        });

        let maxVotes = 0;
        let eliminatedId = null;
        for (const [targetId, count] of Object.entries(voteCounts)) {
          if (count > maxVotes) { maxVotes = count; eliminatedId = targetId; }
          else if (count === maxVotes) eliminatedId = null;
        }

        if (eliminatedId) {
          const eliminated = lobby.players.find(p => p.id === eliminatedId);
          if (eliminated) {
            eliminated.alive = false;
            io.to(lobby.code).emit("chat:msg", { from: "System", text: `${eliminated.name} was voted out.` });
            io.to(lobby.code).emit("chat:msg", { from: "System", text: `${eliminated.name} has died.` });
            if (eliminated.role === "Jester") {
              io.to(lobby.code).emit("chat:msg", { from: "System", text: `Jester wins!` });
              lobby.state = PHASES.ENDED;
              broadcastLobby(lobby.code);
              return;
            }
          }
        } else io.to(lobby.code).emit("chat:msg", { from: "System", text: `No one was eliminated due to a tie.` });

        lobby.actions.votes = {};
      }

      // NIGHT phase
      lobby.state = PHASES.NIGHT;
      broadcastLobby(lobby.code);
      io.to(lobby.code).emit("phase:update", { phase: PHASES.NIGHT });
      io.to(lobby.code).emit("chat:msg", { from: "System", text: "Night has fallen. Mafia, make your move!" });

      setTimeout(() => startDay(lobby), 30000);
    }

    function startDay(lobby) {
      if (!lobby) return;

      const mafiaTarget = lobby.actions.mafiaTarget;
      const doctorSave = lobby.actions.doctorSave;
      const detectiveCheck = lobby.actions.detectiveCheck;

      let killedPlayer = null;

      if (mafiaTarget) {
        const targetPlayer = lobby.players.find(p => p.id === mafiaTarget);
        const savedPlayer = lobby.players.find(p => p.id === doctorSave);

        if (!targetPlayer) {
          io.to(lobby.code).emit("chat:msg", { from: "System", text: "Mafia's target not found." });
        } else if (targetPlayer.id === savedPlayer?.id) {
          io.to(lobby.code).emit("chat:msg", { from: "System", text: `${savedPlayer.name} felt a disturbance in the force. No one was killed during the night.` });
        } else {
          killedPlayer = targetPlayer;
          killedPlayer.alive = false;
          io.to(lobby.code).emit("chat:msg", { from: "System", text: `${killedPlayer.name} was killed during the night.` });
          io.to(lobby.code).emit("chat:msg", { from: "System", text: `${killedPlayer.name} has died.` });
        }
      } else {
        io.to(lobby.code).emit("chat:msg", { from: "System", text: "No one was killed during the night." });
      }

      // Detective info
      if (detectiveCheck) {
        const target = lobby.players.find(p => p.id === detectiveCheck);
        if (target) {
          const roleInfo = target.role === "Mafia" ? "Mafia" : "Not Mafia";
          lobby.players.forEach(p => {
            if (p.role === "Detective" && p.alive) {
              io.to(p.id).emit("night:result", { targetName: target.name, role: roleInfo });
            }
          });
        }
      }

      // Reset night actions
      lobby.actions.mafiaTarget = null;
      lobby.actions.doctorSave = null;
      lobby.actions.detectiveCheck = null;

      if (checkWinCondition(lobby)) return;

      lobby.state = PHASES.DAY;
      broadcastLobby(lobby.code);
      io.to(lobby.code).emit("phase:update", { phase: PHASES.DAY });
      io.to(lobby.code).emit("chat:msg", { from: "System", text: "Day has begun! Discuss and vote to eliminate." });

      setTimeout(() => startNightDayCycle(lobby), 60000);
    }
  });

  // -------------------------
  // Night actions
  // -------------------------
  socket.on("night:action", ({ targetId }) => {
    const code = socketToCode.get(socket.id);
    const lobby = lobbies.get(code);
    if (!lobby || lobby.state !== PHASES.NIGHT) return;

    const player = lobby.players.find(p => p.id === socket.id);
    if (!player || !player.alive) {
      socket.emit("chat:msg", { from: "System", text: "You are dead and cannot act." });
      return;
    }

    const target = lobby.players.find(p => p.id === targetId);
    if (!target) return;

    switch (player.role) {
      case "Mafia":
        if (target.role === "Mafia") {
          socket.emit("chat:msg", { from: "System", text: "You cannot target another Mafia!" });
          return;
        }
        if (!lobby.actions.mafiaTarget) lobby.actions.mafiaTarget = targetId;
        break;
      case "Doctor":
        lobby.actions.doctorSave = targetId;
        break;
      case "Detective":
        lobby.actions.detectiveCheck = targetId;
        break;
    }

    socket.emit("chat:msg", { from: "System", text: `You chose ${target.name} for your night action.` });
  });

  // -------------------------
  // Day votes
  // -------------------------
  socket.on("day:vote", ({ targetId }) => {
    const code = socketToCode.get(socket.id);
    const lobby = lobbies.get(code);
    if (!lobby || lobby.state !== PHASES.DAY) return;

    const voter = lobby.players.find(p => p.id === socket.id);
    const target = lobby.players.find(p => p.id === targetId);

    if (!voter || !voter.alive) {
      socket.emit("chat:msg", { from: "System", text: "You are dead and cannot vote." });
      return;
    }

    lobby.actions.votes[socket.id] = targetId;

    io.to(lobby.code).emit("chat:msg", {
      from: voter.name,
      text: `voted to eliminate ${target ? target.name : "someone"}.`
    });
  });

  // -------------------------
  // Disconnect
  // -------------------------
  socket.on("disconnect", () => removePlayer(socket));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server listening on port", PORT));
