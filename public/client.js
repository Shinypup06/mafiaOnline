const socket = io();
let phaseTimer = null;
let playersGlobal = [];
let myRole = ""; // store your role once received



const $ = id => document.getElementById(id);

function setError(msg) { $("errors").textContent = msg || ""; }

socket.on("error:msg", setError);

$("createBtn").onclick = () => {
  setError("");
  socket.emit("lobby:create", { name: $("name").value });
};

$("joinBtn").onclick = () => {
  setError("");
  socket.emit("lobby:join", { code: $("joinCode").value, name: $("name").value });
};

$("leaveBtn").onclick = () => socket.emit("lobby:leave");
$("startBtn").onclick = () => socket.emit("game:start");

$("chatSend").onclick = () => {
  const text = $("chatInput").value;
  if (!text.trim()) return;
  socket.emit("chat:send", { text });
  $("chatInput").value = "";
};

socket.on("lobby:created", ({ code }) => {
  $("code").textContent = code;
});

socket.on("lobby:update", ({ code, host, state, players }) => {
  $("code").textContent = code || "—";
  $("state").textContent = state ? `Phase: ${state}` : "";
  $("players").innerHTML = "";
  players.forEach(p => {
    const li = document.createElement("li");
    li.textContent = p.name + (p.id === host ? " (host)" : "");
    $("players").appendChild(li);
  });

  playersGlobal = players; // store globally for night actions
});



socket.on("phase:update", ({ phase }) => {
  $("state").textContent = `Phase: ${phase}`;

//   const li = document.createElement("li");
//   li.textContent = `System: Phase changed to ${phase}`;
//   $("chat").appendChild(li);

  let duration = 0;
  if (phase === "night") duration = 30;
  else if (phase === "day") duration = 60;
  else duration = 0;

  if (phaseTimer) clearInterval(phaseTimer);

  const timerDiv = $("timer");
  timerDiv.textContent = `Time left: ${duration}s`;

  phaseTimer = setInterval(() => {
    duration--;
    timerDiv.textContent = `Time left: ${duration}s`;
    if (duration <= 0) {
      clearInterval(phaseTimer);
      phaseTimer = null;
      timerDiv.textContent = "—";
    }
  }, 1000);

  if (phase === "night" && myRole && playersGlobal.length > 1) {
    showNightActions(myRole, playersGlobal);
  } else {
    $("nightActionsCard").style.display = "none";
  }

    if (phase === "day") {
    showDayVoting(playersGlobal);
  } else {
    $("dayActionsCard").style.display = "none";
  }
});

socket.on("night:result", ({ targetName, role }) => {
  const li = document.createElement("li");
  li.textContent = `System (Detective): ${targetName} is ${role}.`;
  li.style.fontWeight = "bold"; // optional highlight
  $("chat").appendChild(li);
});


function showDayVoting(players) {
  const container = $("dayActionsButtons");
  const card = $("dayActionsCard");
  container.innerHTML = "";

  card.style.display = "block";

  players.forEach(p => {
    if (p.id === socket.id) return; // cannot vote self
    const btn = document.createElement("button");
    btn.textContent = p.name;
    btn.onclick = () => {
      socket.emit("day:vote", { targetId: p.id });
      card.style.display = "none";
    //   const li = document.createElement("li");
    //   li.textContent = `System: You voted to eliminate ${p.name}.`;
    //   $("chat").appendChild(li);
    };
    container.appendChild(btn);
  });
}

function showNightActions(role, players) {
  const container = $("nightActionsButtons");
  const card = $("nightActionsCard");
  container.innerHTML = ""; // clear previous buttons

  if (!["Mafia", "Doctor", "Detective"].includes(role)) {
    card.style.display = "none";
    return;
  }

  card.style.display = "block";

  const targetList = players.filter(p => p.id !== socket.id);
  targetList.forEach(p => {
    const btn = document.createElement("button");
    btn.textContent = p.name;
    btn.onclick = () => {
      socket.emit("night:action", { targetId: p.id });
      card.style.display = "none"; // hide after choosing
      const li = document.createElement("li");
      li.textContent = `You chose ${p.name} for your night action.`;
      $("chat").appendChild(li);
    };
    container.appendChild(btn);
  });
}


socket.on("state:update", (state) => {
  if (state.phase === "night" && state.selfRole !== "mafia") {
    $("chatInput").disabled = true;
    $("chatInput").placeholder = "You cannot chat at night.";
  } else {
    $("chatInput").disabled = false;
    $("chatInput").placeholder = "Type a message...";
  }
});



socket.on("game:started", ({ state }) => {
  $("state").textContent = `State: ${state}`;
});

socket.on("game:role", ({ role }) => {
  myRole = role;
  $("role").textContent = role;
});


socket.on("chat:msg", ({ from, text }) => {
  const li = document.createElement("li");
  li.textContent = from ? `${from}: ${text}` : text;
  $("chat").appendChild(li);
});

socket.on("chatMessage", data => {
  const chatBox = document.getElementById("chatBox");
  const msgDiv = document.createElement("div");

  if (data.mafiaOnly) {
    msgDiv.textContent = `(Mafia Chat) ${data.sender}: ${data.message}`;
    msgDiv.style.color = "red"; // Different color for mafia chat
  } else {
    msgDiv.textContent = `${data.sender}: ${data.message}`;
  }

  chatBox.appendChild(msgDiv);
  chatBox.scrollTop = chatBox.scrollHeight;
});

socket.on("phaseChange", phase => {
  const chatInput = document.getElementById("chatInput");

  if (phase === "night") {
    chatInput.disabled = (role !== "mafia"); 
  } else {
    chatInput.disabled = false;
  }
});


