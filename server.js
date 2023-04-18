/*jslint node: true */
/*jshint -W061 */
/*global Map*/
// TO CONSIDER: Tweak how entity physics work (IE: When two entities collide, they push out from the center. This would allow stuff like "bullet ghosting" to happen, making certain UP tanks viable.)
// TO DO: Give bosses name colors via a NAME_COLOR attribute and/or colored broadcasts, fix this.usesAltFire, fix bugs with zoom cooldown, fix FFA_RED overriding custom bullet colors
// ^ Fix boss AI range issues
"use strict";
const serverPrefix = process.argv[2] || "";
const defsPrefix = process.argv[3] || "";
const util = require("./lib/util");
const ran = require("./lib/random");
const hshg = require("./lib/hshg");
const tokens = require("./tokens.json");
const BETA_TOKENS_1 = tokens.LEVEL_1;
const BETA_TOKENS_2 = tokens.LEVEL_2;
const BETA_TOKENS_3 = tokens.LEVEL_3;
const BETA_COLORS_1 = tokens.COLOR_1;
const BETA_COLORS_2 = tokens.COLOR_2;
const BETA_COLORS_3 = tokens.COLOR_3;

Array.prototype.remove = index => {
    if (index === this.length - 1) return this.pop();
    else {
        let r = this[index];
        this[index] = this.pop();
        return r;
    }
};

let c = require(`../../configs/config${serverPrefix}.json`),
    tankList = [],
    room = {
        lastCycle: undefined,
        cycleSpeed: 1000 / c.gameSpeed / 30,
        width: c.WIDTH,
        height: c.HEIGHT,
        setup: c.ROOM_SETUP,
        xgrid: c.X_GRID,
        ygrid: c.Y_GRID,
        gameMode: c.MODE,
        skillBoost: c.SKILL_BOOST,
        scale: {
            square: c.WIDTH * c.HEIGHT / 1e8,
            linear: Math.sqrt(c.WIDTH * c.HEIGHT / 1e8)
        },
        maxFood: c.WIDTH * c.HEIGHT / 1e5 * c.FOOD_AMOUNT,
        isInRoom: location => location.x > 0 && location.x < c.WIDTH && location.y > 0 && location.y < c.HEIGHT,
        topPlayerID: -1,
        networkSpeed: 1000 / 30,
        testingMode: c.testingMode,
        speed: c.gameSpeed,
        timeUntilRestart: c.restarts.interval,
        maxBots: c.BOTS,
        arenaClosed: false,
        teamAmount: c.TEAM_AMOUNT,
        modelMode: c.modelMode,
        fps: "Unknown",
        bossRushOver: false,
        awpBossLevel: 0,
        bossString: "",
        motherships: [],
        cardinals: [
            ["NW", "Northern", "NE"],
            ["Western", "Center", "Eastern"],
            ["SW", "Southern", "SE"]
        ],
        manualOffset: 0
    };
const Class = (() => {
    let def = require(`./lib/definitions${room.modelMode ? "_basic" : defsPrefix}`),
        i = 0;
    for (let k in def) {
        if (!def.hasOwnProperty(k)) continue;
        def[k].index = i++;
        tankList.push(def[k]);
    }
    return def;
})();

room.findType = type => {
    let output = [],
        j = 0;
    for (let row of room.setup) {
        let i = 0;
        for (let cell of row) {
            if (cell === type) output.push({
                x: (i + .5) / room.xgrid * room.width,
                y: (j + .5) / room.ygrid * room.height,
                id: i * room.xgrid + j
            });
            i++;
        }
        j++;
    }
    room[type] = output;
};
room.findType("bas1");
room.findType("bas2");
room.findType("bas3");
room.findType("bas4");
room.findType("bas5");
room.findType("bas6");
room.findType("bas7");
room.findType("bas8");
room.findType("n_b1");
room.findType("n_b2");
room.findType("n_b3");
room.findType("n_b4");
room.findType("n_b5");
room.findType("n_b6");
room.findType("n_b7");
room.findType("n_b8");
room.findType("mot1");
room.findType("mot2");
room.findType("mot3");
room.findType("mot4");
room.findType("mot5");
room.findType("mot6");
room.findType("mot7");
room.findType("mot8");
room.findType("nest");
room.findType("norm");
room.findType("roid");
room.findType("rock");
room.findType("domi");
room.findType("edge");
room.findType("port");
room.nestFoodAmount = 1.6 * Math.sqrt(room.nest.length) / room.xgrid / room.ygrid;
room.random = () => ({
    x: ran.irandom(room.width),
    y: ran.irandom(room.height)
});
room.randomType = type => {
    let choice = room[type][ran.irandom(room[type].length - 1)];
    return {
        x: ran.irandom(.5 * room.width / room.xgrid) * ran.choose([-1, 1]) + choice.x,
        y: ran.irandom(.5 * room.height / room.ygrid) * ran.choose([-1, 1]) + choice.y
    };
};
room.gauss = clustering => {
    let output;
    do output = {
        x: ran.gauss(room.width / 2, room.height / clustering),
        y: ran.gauss(room.width / 2, room.height / clustering)
    };
    while (!room.isInRoom(output));
};
room.gaussInverse = clustering => {
    let output;
    do output = {
        x: ran.gaussInverse(0, room.width, clustering),
        y: ran.gaussInverse(0, room.height, clustering)
    };
    while (!room.isInRoom(output));
    return output;
};
room.gaussRing = (radius, clustering) => {
    let output;
    do {
        output = ran.gaussRing(room.width * radius, clustering);
        output = {
            x: output.x + room.width / 2,
            y: output.y + room.height / 2
        };
    } while (!room.isInRoom(output));
    return output;
};
room.isIn = (type, location) => {
    if (!room.isInRoom(location)) return false;
    let x = Math.floor(location.y * room.ygrid / room.height),
        y = Math.floor(location.x * room.xgrid / room.width);
    return type === room.setup[x][y];
};
room.isInNorm = location => {
    if (!room.isInRoom(location)) return false;
    let x = Math.floor(location.y * room.ygrid / room.height),
        y = Math.floor(location.x * room.xgrid / room.width);
    return room.setup[x][y] !== "nest";
};
room.isAt = location => {
    if (!room.isInRoom(location)) return false;
    let x = Math.floor(location.x * room.xgrid / room.width),
        y = Math.floor(location.y * room.ygrid / room.height);
    return {
        x: (x + .5) / room.xgrid * room.width,
        y: (y + .5) / room.ygrid * room.height,
        id: x * room.xgrid + y
    };
};
room.setType = (type, location) => {
    if (!room.isInRoom(location)) return;
    let x = Math.floor(location.y * room.ygrid / room.height),
        y = Math.floor(location.x * room.xgrid / room.width);
    room.setup[x][y] = type;
    sockets.broadcastRoom();
};
room.gaussType = (type, clustering) => {
    let choice = room[type][ran.irandom(room[type].length - 1)],
        location = {};
    do location = {
        x: ran.gauss(choice.x, room.width / room.xgrid / clustering),
        y: ran.gauss(choice.y, room.height / room.ygrid / clustering)
    };
    while (!room.isIn(type, location));
    return location;
};
room.init = () => {
    if (c.ROOM_SETUP.length !== c.Y_GRID) {
        util.warn("c.Y_GRID has conflicts with the current room setup. Please check these configs and relaunch.");
        process.exit();
    }
    let fail = false;
    for (let i = 0; i < c.ROOM_SETUP.length; i++)
        if (c.ROOM_SETUP[i].length !== c.X_GRID) fail = true;
    if (fail) {
        util.warn("c.X_GRID has conflicts with the current room setup. Please check these configs and relaunch.");
        process.exit();
    }
    util.log(room.width + " x " + room.height + " room initalized. Max food: " + Math.round(room.maxFood) + ". Max nest food: " + Math.round(room.maxFood * room.nestFoodAmount) + ".");
    if (c.restarts.enabled) {
        let totalTime = c.restarts.interval;
        setTimeout(() => util.log("Automatic server restarting is enabled. Time until restart: " + room.timeUntilRestart / 3600 + " hours."), 340);
        setInterval(() => {
            room.timeUntilRestart--;
            if (room.timeUntilRestart === 1800 || room.timeUntilRestart === 900 || room.timeUntilRestart === 600 || room.timeUntilRestart === 300) {
                if (c.serverName.includes("Boss")) sockets.broadcast(`WARNING: Tanks have ${room.timeUntilRestart / 60} minutes to defeat the boss rush!`, "#FFE46B");
                else sockets.broadcast(`WARNING: The server will automatically restart in ${room.timeUntilRestart / 60} minutes!`, "#FFE46B");
                util.warn(`Automatic restart will occur in ${room.timeUntilRestart / 60} minutes.`);
            }
            if (!room.timeUntilRestart) {
                let reason = c.serverName.includes("Boss") ? "Reason: The tanks could only defeat " + room.awpBossLevel + "/15 bosses" : "Reason: Uptime has reached " + totalTime / 60 / 60 + " hours";
                if (c.enableBot) sendClosed(c.serverName, reason, "Preparing the server for an automatic restart...");
                util.warn("Automatic server restart initialized! Closing arena...");
                let toAdd = c.serverName.includes("Boss") ? "Tanks have run out of time to kill the bosses!" : c.serverName.includes("Domination") ? "No team has managed to capture all of the Dominators! " : c.serverName.includes("Mothership") ? "No team's Mothership has managed to become the last Mothership standing! " : "";
                sockets.broadcast(toAdd + "Automatic server restart initializing...", "#FFE46B");
                setTimeout(() => closeArena(), 2500);
                if (c.serverName.includes("Boss")) room.bossRushOver = true;
            }
        }, 1000);
    }
    if (c.PORTALS.ENABLED) util.log("Portal mode is enabled.");
    if (room.modelMode) util.warn("Model mode is enabled. This will only allow for you to make and see tank models. No shapes or bosses will spawn, and Basic is the only tank.");
};

class Vector {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
    update() {
        this.len = this.length;
        this.dir = this.direction;
    }
    isShorterThan(v1, v2) {
        return Math.pow(v1.x, 2) + Math.pow(v1.y, 2) > Math.pow(v2, 2);
    }
    null() {
        this.x = this.y = 0;
    }
    unit() {
        let length = this.length;
        if (length === 0) return new Vector(1, 0);
        return new Vector(this.x / length, this.y / length);
    }
    get length() {
        return Math.sqrt(Math.pow(this.x, 2) + Math.pow(this.y, 2)); // Math.hypot
    }
    get direction() {
        return Math.atan2(this.y, this.x);
    }
}
class PriorityQueue {
    constructor() {
        this.clear();
    }
    clear() {
        this.array = [];
        this.sorted = true;
    }
    enqueue(priority, to) {
        this.array.push([priority, to]);
        this.sorted = false;
    }
    dequeue() {
        if (!this.sorted) {
            this.array.sort((a, b) => b[0] - a[0]);
            this.sorted = true;
        }
        return this.array.pop()[1];
    }
    getCount() {
        return this.array.length;
    }
}

const nearest = (array, location, test = () => true) => {
    if (!array.length) return undefined;
    let list = new PriorityQueue(),
        d;
    for (let instance of array) {
        d = Math.pow(instance.x - location.x, 2) + Math.pow(instance.y - location.y, 2);
        if (test(instance, d)) list.enqueue(d, instance);
    }
    return list.dequeue();
};
const timeOfImpact = (p, v, s) => {
    let a = s * s - (v.x * v.x + v.y * v.y),
        b = p.x * v.x + p.y * v.y,
        _c = p.x * p.x + p.y * p.y,
        d = b * b + a * _c,
        t = 0;
    if (d >= 0) t = Math.max(0, (b + Math.sqrt(d)) / a);
    return t ? t * .9 : 0;
};
const editStatusMessage = status => {
    let messageID = null,
        statusName = null;
    switch (c.botPrefix) {
        case "+":
            messageID = "717119680434929784";
            statusName = "Free For All";
            break;
        case "_":
            messageID = "717119746092302396";
            statusName = "2TDM Domination";
            break;
        case "&":
            messageID = "717119705818857593";
            statusName = "4TDM";
            break;
        case "$":
            messageID = "717119892964245545";
            statusName = "Developer Server";
            break;
        case ".":
            messageID = "717119763121438801";
            statusName = "Portal Domination";
            break;
        case "%":
            messageID = "717119824731439214";
            statusName = "4TDM Maze";
            break;
        case "=":
            messageID = "717119865181306982";
            statusName = "Boss Rush";
            break;
        case ";":
            messageID = "717119719249018921";
            statusName = "2TDM";
            break;
        default:
            throw (`Invalid bot prefix detected: ${c.botPrefix}. If the bot prefix is new, please make sure to add it to editStatusMessage() and the help commands.`);
    }
    if (messageID != null && statusName != null) bot.editMessage("442752920174329857", messageID, `**${statusName}:** ${status}`);
};
const sendClosed = (title1, title2, text) => {
    bot.createMessage("697659268211671090", {
        embed: {
            author: {
                name: title1,
                icon_url: "https://cdn.discordapp.com/avatars/462721019959050240/ee8807bc4fccc425cde794713c9daf54.png?size=256"
            },
            color: 0xFF0000,
            fields: [{
                name: title2,
                value: text,
                inline: false
            }, {
                name: "Current Time",
                value: " " + new Date(),
                inline: false
            }]
        }
    });
};
const spawnBot = (loc = null) => {
    let position = loc,
        max = 100;
    if (!loc) {
        do position = room.randomType("norm");
        while (dirtyCheck(position, 400) && max-- > 0);
    }
    let o = new Entity(position);
    o.color = 12;
    if (room.gameMode === "tdm") {
        let team = Math.floor(room.teamAmount * Math.random()) + 1;
        o.team = -team;
        o.color = [10, 12, 11, 15, 3, 35, 36, 0][team - 1];
    }
    let tank = "basic",
        botType = "bot",
        skillSet = ran.chooseBuild("norm"),
        choice = ran.chooseChance(80, 8, 12, 4, 1, 2);
    switch (choice) {
        case 0:
            tank = ran.chooseTank("norm");
            break;
        case 1:
            botType = "bot2";
            skillSet = ran.chooseBuild("smash");
            tank = ran.chooseTank("smash");
            break;
        case 2:
            botType = "bot2";
            skillSet = ran.chooseBuild("boost");
            tank = ran.chooseTank("boost");
            break;
        case 3:
            skillSet = ran.chooseBuild("normWeak");
            tank = ran.chooseTank("norm");
            break;
        case 4:
            botType = "bot2";
            skillSet = ran.chooseBuild("smashWeak");
            tank = ran.chooseTank("smash");
            break;
        case 5:
            botType = "bot2";
            skillSet = ran.chooseBuild("boostWeak");
            tank = ran.chooseTank("boost");
            break;
        default:
            util.warn("Unknown bot type: " + choice + "!");
            tank = ran.chooseTank("norm");
    }
    o.isBot = true;
    o.define(Class[botType]);
    o.skill.set(skillSet);
    o.tank = tank;
    o.define(Class[tank]);
    o.name = "[AI] " + ran.chooseBotName();
    o.skill.score = 26302; // 59212
    o.dangerValue = 7;
    o.nameColor = o.name.includes("Bee") ? "#FFF782" : o.name.includes("Honey Bee") ? "#FCCF3B" : o.name.includes("Fallen") ? "#CCCCCC" : "#C1CAFF";
    //o.facing += ran.randomRange(.5 * Math.PI, Math.PI); // Does nothing
    o.autoOverride = true;
    setTimeout(() => {
        o.autoOverride = false;
    }, 2000);
    if (room.maxBots > 0) bots.push(o);
};
const closeArena = () => {
    if (c.serverName.includes("Boss")) room.bossRushOver = true;
    room.arenaClosed = true;
    if (c.enableBot) editStatusMessage("Offline");
    sockets.broadcast("Arena Closed: No players can join.", "#FF0000");
    for (let socket of clients) socket.talk("P", "The arena has closed. Please try again later once the server restarts.");
    if (room.modelMode) {
        util.warn("Closing server...");
        return setTimeout(() => process.exit(), 750);
    }
    let closers = [
            Class.arenaCloserAI,
            Class.arenaCloser5AI,
            Class.machCloserAI,
            Class.boostCloserAI,
            Class.rediShotgunAI,
            Class.bigChungusAI,
            Class.sniperCloserAI,
            Class.hotwheelsAI,
            Class.absoluteCyanideAI,
            Class.arenaSummonerAI,
            Class.trapperCloserAI,
            Class.borerCloserAI,
            Class.hybridCloserAI,
            Class.acCeptionAI,
            Class.minishotCloserAI,
            Class.octoArenaCloserAI,
            Class.spreadCloserAI,
            Class.ac3ai
        ],
        positions = [{
            x: room.width * .25,
            y: room.height * -.25
        }, {
            x: room.width * .25,
            y: room.height * 1.25
        }, {
            x: room.width * -.25,
            y: room.height * .25
        }, {
            x: room.width * 1.25,
            y: room.height * .25
        }, {
            x: room.width * .75,
            y: room.height * -.25
        }, {
            x: room.width * 1.25,
            y: room.height * 1.25
        }, {
            x: room.width * -.25,
            y: room.height * .75
        }, {
            x: room.width * 1.25,
            y: room.height * .75
        }];
    for (let i = 0; i < 8; i++) {
        let o = new Entity(positions[i]);
        o.define(ran.choose(closers));
        o.team = -100;
        o.alwaysActive = true;
        //o.facing += ran.randomRange(.5 * Math.PI, Math.PI); // Does nothing
    }
    for (let body of bots) body.kill();
    let completed = false;
    setInterval(() => {
        let alivePlayers = players.filter(player => player.body != null && player.body.type === "tank");
        for (let player of alivePlayers) {
            let body = player.body;
            body.passive = body.invuln = body.godmode = false;
            for (let o of entities)
                if (o.master.id === body.id && o.id !== body.id) o.passive = false;
            body.dangerValue = 7;
        }
        if (!alivePlayers.length && !completed) setTimeout(() => {
            completed = true;
            util.warn("All players are dead! Ending process...");
            process.exit();
        }, 1000);
    }, 100);
    setTimeout(() => {
        completed = true;
        util.warn("Arena Closers took too long! Ending process...");
        process.exit();
    }, 6e4);
};
const dominatorLoop = () => {
    let choices = [Class.destroyerDominatorAI, Class.gunnerDominatorAI, Class.trapperDominatorAI, Class.crockettDominatorAI, Class.steamrollDominatorAI, Class.autoDominatorAI],
        doms = {};
    for (let loc of room.domi) {
        let domType = choices[ran.chooseChance(35, 35, 10, 8, 10, 10)],
            o = new Entity(loc);
        o.define(domType);
        o.isDominator = true;
        o.alwaysActive = true;
        o.team = -100;
        o.SIZE = 70;
        o.color = 13; //3
        o.settings.hitsOwnType = "pushOnlyTeam";
        o.miscIdentifier = "appearOnMinimap";
        o.FOV = .5;
        o.onDead = () => {
            let killers = [];
            for (let instance of o.collisionArray)
                if (instance.team >= -room.teamAmount && instance.team <= -1) killers.push(instance.team);
            let killTeam = killers.length ? ran.choose(killers) : 0,
                n = new Entity(loc),
                wrong = 0,
                team = ["INVALID", "BLUE", "RED", "GREEN", "PURPLE", "YELLOW", "ORANGE", "PINK", "TEAL"][-killTeam],
                teamColor = ["#000000", "#00B0E1", "#F04F54", "#00E06C", "#BE7FF5", "#FFEB8E", "#F37C20", "#E85DDF", "#8EFFFB"][-killTeam];
            if (o.team !== -100) killTeam = 0;
            for (let id of Object.keys(doms))
                if (doms[id] !== killTeam) wrong++;
            for (let body of entities)
                if (body.team === killTeam && body.type === "tank" && !body.underControl) body.sendMessage("Press H to control the Dominator!");
            sockets.broadcast("The " + room.cardinals[Math.floor(3 * loc.y / room.height)][Math.floor(3 * loc.x / room.height)] + " Dominator is " + (killTeam ? "now captured by " + team : "being contested") + "!", killTeam ? teamColor : "#FFE46B");
            room.setType(`dom${-killTeam || "i"}`, loc);
            n.define(domType);
            n.isDominator = true;
            n.alwaysActive = true;
            n.team = killTeam || -100;
            n.SIZE = 70;
            n.color = [13, 10, 12, 11, 15, 3, 35, 36, 0][-killTeam];
            n.onDead = o.onDead;
            n.settings.hitsOwnType = "pushOnlyTeam";
            n.miscIdentifier = "appearOnMinimap";
            n.FOV = .5;
            o = n;
            doms[loc.id] = killTeam || -100;
            if (wrong === 1 && killTeam && !room.arenaClosed) {
                util.warn(team + " has won the game! Closing arena...");
                setTimeout(() => sockets.broadcast(team + " has won the game!", teamColor), 2e3);
                if (c.enableBot) sendClosed(c.serverName, "Reason: Round Over", team + " has won the game! Closing arena..."); // Considering adding team colors to this
                setTimeout(() => closeArena(), 5e3);
            }
        };
        doms[loc.id] = -100;
    }
};
const mothershipLoop = (loc, team) => {
    let o = new Entity(loc),
        teams = ["BLUE", "RED", "GREEN", "PURPLE", "YELLOW", "ORANGE", "PINK", "TEAL"],
        teamColors = ["#00B0E1", "#F04F54", "#00E06C", "#BE7FF5", "#FFEB8E", "#F37C20", "#E85DDF", "#8EFFFB"];
    o.define(Class.mothership);
    o.isMothership = true;
    o.miscIdentifier = "appearOnMinimap";
    o.alwaysActive = true;
    o.team = -team;
    o.color = [10, 12, 11, 15, 3, 35, 36, 0][team - 1];
    o.nameColor = teamColors[team - 1];
    o.settings.hitsOwnType = "pushOnlyTeam";
    o.onDead = () => {
        sockets.broadcast(teams[team - 1] + "'s Mothership has been killed!", teamColors[team - 1]);
        if (room.motherships.length !== 1) util.remove(room.motherships, room.motherships.indexOf(o));
        if (room.arenaClosed || room.motherships.length !== 1) return;
        util.warn(teams[-room.motherships[0].team - 1] + " has won the game! Closing arena...");
        setTimeout(() => sockets.broadcast(teams[-room.motherships[0].team - 1] + " has won the game!", teamColors[-room.motherships[0].team - 1]), 2e3);
        if (c.enableBot) sendClosed(c.serverName, "Reason: Round Over", teams[-room.motherships[0].team - 1] + " has won the game! Closing arena...");
        setTimeout(() => closeArena(), 5e3);
    };
    room.motherships.push(o);
};
const bossRushLoop = loc => {
    if (room.bossRushOver) return;
    room.awpBossLevel++;
    let o = new Entity(loc);
    o.team = -100;
    o.passive = true;
    setTimeout(() => o.passive = false, 10000);
    const onDead = () => bossRushLoop(room.random());
    switch (room.awpBossLevel) {
        case 1:
            setTimeout(() => {
                sockets.broadcast("Upcoming Boss: AWP-1...", "#FFE46B");
            }, 5000);
            setTimeout(() => {
                o.define(Class.AWP_1AI);
                o.onDead = onDead;
                sockets.broadcast("Round 1 has begun: AWP-1!", "#FFE46B");
                util.spawn("An AWP-1 has spawned!");
            }, 10000);
            break;
        case 2:
            setTimeout(() => {
                sockets.broadcast("Upcoming Boss: AWP-14...", "#FFE46B");
            }, 5000);
            setTimeout(() => {
                o.define(Class.AWP_14AI);
                o.onDead = onDead;
                sockets.broadcast("Round 2 has begun: AWP-14!", "#FFE46B");
                util.spawn("An AWP-14 has spawned!");
            }, 10000);
            break;
        case 3:
            setTimeout(() => {
                sockets.broadcast("Upcoming Boss: AWP-sin((4*pi)/45)...", "#FFE46B");
            }, 5000);
            setTimeout(() => {
                o.define(Class.AWP_sin16AI);
                o.onDead = onDead;
                sockets.broadcast("Round 3 has begun: AWP-sin((4*pi)/45)!", "#FFE46B");
                util.spawn("An AWP-sin((4*pi)/45) has spawned!");
            }, 10000);
            break;
        case 4:
            room.bossString = ran.choose(["AWP-tan((3*pi)/10)", "AWP-log(24)"]);
            setTimeout(() => {
                sockets.broadcast("Upcoming Boss: " + room.bossString + "...", "#FFE46B");
            }, 5000);
            setTimeout(() => {
                if (room.bossString === "AWP-log(24)") o.define(Class.AWP_log24AI);
                else o.define(Class.AWP_tan54AI);
                o.onDead = onDead;
                sockets.broadcast("Round 4 has begun: " + room.bossString + "!", "#FFE46B");
                util.spawn(`An ${room.bossString} has spawned!`);
            }, 10000);
            break;
        case 5:
            setTimeout(() => {
                sockets.broadcast("Upcoming Boss: AWP-69...", "#FFE46B");
            }, 5000);
            setTimeout(() => {
                o.define(Class.AWP_69AI);
                o.onDead = onDead;
                sockets.broadcast("Round 5 has begun: AWP-69!", "#FFE46B");
                util.spawn("An AWP-69 has spawned!");
            }, 10000);
            break;
        case 6:
            setTimeout(() => {
                sockets.broadcast("Upcoming Boss: AWP-cos((13*pi)/60)...", "#FFE46B");
            }, 5000);
            setTimeout(() => {
                o.define(Class.AWP_cos39AI);
                o.onDead = onDead;
                sockets.broadcast("Round 6 has begun: AWP-cos((13*pi)/60)!", "#FFE46B");
                util.spawn("An AWP-cos((13*pi)/60) has spawned!");
            }, 10000);
            break;
        case 7:
            room.bossString = ran.choose(["AWP-24", "AWP-Ice"]);
            setTimeout(() => {
                sockets.broadcast("Upcoming Boss: " + room.bossString + "...", "#FFE46B");
            }, 5000);
            setTimeout(() => {
                if (room.bossString === "AWP-24") o.define(Class.AWP_24AI);
                else o.define(Class.AWP_IceAI);
                o.onDead = onDead;
                sockets.broadcast("Round 7 has begun: " + room.bossString + "!", "#FFE46B");
                util.spawn(`An ${room.bossString} has spawned!`);
            }, 10000);
            break;
        case 8:
            room.bossString = ran.choose(["AWP-Ring", "AWP-Pistolstar"]);
            setTimeout(() => {
                sockets.broadcast("Upcoming Boss: " + room.bossString + "...", "#FFE46B");
            }, 5000);
            setTimeout(() => {
                if (room.bossString === "AWP-Ring") o.define(Class.AWP_RingAI);
                else o.define(Class.AWP_psAI);
                o.onDead = onDead;
                sockets.broadcast("Round 8 has begun: " + room.bossString + "!", "#FFE46B");
                util.spawn(`An ${room.bossString} has spawned!`);
            }, 10000);
            break;
        case 9:
            setTimeout(() => {
                sockets.broadcast("Upcoming Boss: AWP-cos((13*pi)/60)...", "#FFE46B");
            }, 5000);
            setTimeout(() => {
                o.define(Class.AWP_cos5AI);
                o.onDead = onDead;
                sockets.broadcast("Round 9 has begun: AWP-cos((13*pi)/60)!", "#FFE46B");
                util.spawn("An AWP-cos((13*pi)/60) has spawned!");
            }, 10000);
            break;
        case 10:
            setTimeout(() => {
                sockets.broadcast("Upcoming Boss: AWP-11...", "#FFE46B");
            }, 5000);
            setTimeout(() => {
                o.define(Class.AWP_11AI);
                o.onDead = onDead;
                sockets.broadcast("Round 10 has begun: AWP-11!", "#FFE46B");
                util.spawn("The AWP-11 has spawned!");
            }, 10000);
            break;
        case 11:
            setTimeout(() => {
                sockets.broadcast("Upcoming Boss: AWP-21...", "#FFE46B");
            }, 5000);
            setTimeout(() => {
                o.define(Class.AWP_21AI);
                o.onDead = onDead;
                sockets.broadcast("Round 11 has begun: AWP-21!", "#FFE46B");
                util.spawn("An AWP-21 has spawned!");
            }, 10000);
            break;
        case 12:
            setTimeout(() => {
                sockets.broadcast("Upcoming Boss: AWP-8...", "#FFE46B");
            }, 5000);
            setTimeout(() => {
                o.define(Class.AWP_8AI);
                o.onDead = onDead;
                sockets.broadcast("Round 12 has begun: AWP-8!", "#FFE46B");
                util.spawn("An AWP-8 has spawned!");
            }, 10000);
            break;
        case 13:
            setTimeout(() => {
                sockets.broadcast("Upcoming Boss: AWP-28...", "#FFE46B");
            }, 5000);
            setTimeout(() => {
                o.define(Class.AWP_28AI);
                o.onDead = onDead;
                sockets.broadcast("Round 13 has begun: AWP-28!", "#FFE46B");
                util.spawn("An AWP-28 has spawned!");
            }, 10000);
            break;
        case 14:
            room.bossString = ran.choose(["EK-3", "Elite Rifle"]);
            setTimeout(() => {
                sockets.broadcast("Upcoming Boss: " + room.bossString + "...", "#FFE46B");
            }, 5000);
            setTimeout(() => {
                if (room.bossString === "EK-3") o.define(Class.EK_3AI);
                else o.define(Class.eliteRifleAI);
                o.onDead = onDead;
                sockets.broadcast("Round 14 has begun: " + room.bossString + "!", "#FFE46B");
                util.spawn(`An ${room.bossString} has spawned!`);
            }, 10000);
            break;
        case 15:
            setTimeout(() => {
                sockets.broadcast("Upcoming Boss: RK-1...", "#FFE46B");
            }, 5000);
            setTimeout(() => {
                o.define(Class.RK_1AI);
                o.onDead = onDead;
                sockets.broadcast("Round 15 has begun: RK-1!", "#FFE46B");
                util.spawn("An RK-1 has spawned!");
            }, 10000);
            break;
        default:
            o.kill();
            room.bossRushOver = true;
            util.warn("The tanks have won the boss rush! Closing arena...");
            setTimeout(() => sockets.broadcast("The boss rush is over! The tanks have won!", "#FFE46B"), 2e3);
            if (c.enableBot) sendClosed(c.serverName, "Reason: Round Over", "The tanks have won the boss rush! Closing arena...");
            setTimeout(() => closeArena(), 5e3);
            break;
    }
};
const getEntity = id => {
    let entity = null;
    for (let body of entities)
        if (body.id === id) entity = body;
    return entity;
};
const trimName = name => name.replace("\u202E", "").trim() || "An unnamed player";
const quickCombine = stats => {
    if (stats == null) return "Please input a valid array of gun settings.";
    if (stats.length === 13) return "Please make sure to place the gun settings in an array.";
    let data = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    for (let value of stats)
        for (let i = 0; i < data.length; ++i) data[i] *= value[i];
    return data;
};
room.init();

class IO {
    constructor(b) {
        this.body = b;
        this.acceptsFromTop = true;
    }
    think() {
        return {
            target: null,
            goal: null,
            fire: null,
            main: null,
            alt: null,
            power: null
        };
    }
}
class io_doNothing extends IO {
    constructor(b) {
        super(b);
        this.acceptsFromTop = false;
    }
    think() {
        return {
            goal: {
                x: this.body.x,
                y: this.body.y
            },
            main: false,
            alt: false,
            fire: false
        };
    }
}
class io_moveInCircles extends IO {
    constructor(b) {
        super(b);
        this.acceptsFromTop = false;
        this.timer = ran.irandom(10) + 3;
        this.goal = {
            x: this.body.x + 7.5 * Math.cos(-this.body.facing),
            y: this.body.y + 7.5 * Math.sin(-this.body.facing)
        };
    }
    think() {
        if (!(this.timer--)) {
            this.timer = 10;
            this.goal = {
                x: this.body.x + 7.5 * Math.cos(-this.body.facing),
                y: this.body.y + 7.5 * Math.sin(-this.body.facing)
            };
        }
        return {
            goal: this.goal
        };
    }
}
class io_listenToPlayer extends IO {
    constructor(b, p) {
        super(b);
        this.player = p;
        this.acceptsFromTop = false;
    }
    think() {
        let targ = {
            x: this.player.target.x,
            y: this.player.target.y
        };
        if (this.player.command.autospin) {
            let kk = Math.atan2(this.body.control.target.y, this.body.control.target.x) + this.body.spinSpeed;
            targ = {
                x: 275 * Math.cos(kk),
                y: 275 * Math.sin(kk)
            };
        }
        if (this.body.invuln && (this.player.command.right || this.player.command.left || this.player.command.up || this.player.command.down || this.player.command.lmb)) this.body.invuln = false;
        this.body.autoOverride = this.body.passive || this.player.command.override;
        return {
            target: targ,
            goal: {
                x: this.body.x + this.player.command.right - this.player.command.left,
                y: this.body.y + this.player.command.down - this.player.command.up
            },
            fire: this.player.command.lmb || this.player.command.autofire,
            main: this.player.command.lmb || this.player.command.autospin || this.player.command.autofire,
            alt: this.player.command.rmb
        };
    }
}
class io_listenToPlayerStatic extends IO {
    constructor(b, p) {
        super(b);
        this.player = p;
        this.acceptsFromTop = false;
    }
    think() {
        let targ = {
            x: this.player.target.x,
            y: this.player.target.y
        };
        if (this.player.command.autospin) {
            let kk = Math.atan2(this.body.control.target.y, this.body.control.target.x) + .02;
            targ = {
                x: 275 * Math.cos(kk),
                y: 275 * Math.sin(kk)
            };
        }
        if (this.body.invuln && (this.player.command.right || this.player.command.left || this.player.command.up || this.player.command.down || this.player.command.lmb)) this.body.invuln = false;
        this.body.autoOverride = this.body.passive || this.player.command.override;
        return {
            target: targ,
            fire: this.player.command.lmb || this.player.command.autofire,
            main: this.player.command.lmb || this.player.command.autospin || this.player.command.autofire,
            alt: this.player.command.rmb
        };
    }
}
class io_mapTargetToGoal extends IO {
    constructor(b) {
        super(b);
    }
    think(input) {
        if (input.main || input.alt) return {
            goal: {
                x: input.target.x + this.body.x,
                y: input.target.y + this.body.y
            },
            power: 1
        };
    }
}
class io_boomerang extends IO {
    constructor(b) {
        super(b);
        this.r = 0;
        this.b = b;
        this.m = b.master;
        this.turnover = false;
        let len = 10 * util.getDistance({
            x: 0,
            y: 0
        }, b.master.control.target);
        this.myGoal = {
            x: 3 * b.master.control.target.x + b.master.x,
            y: 3 * b.master.control.target.y + b.master.y
        };
    }
    think(input) {
        if (this.b.range > this.r) this.r = this.b.range;
        let t = 1;
        if (!this.turnover) {
            if (this.r && this.b.range < this.r * .5) this.turnover = true;
            return {
                goal: this.myGoal,
                power: t
            };
        } else return {
            goal: {
                x: this.m.x,
                y: this.m.y
            },
            power: t
        };
    }
}
class io_goToMasterTarget extends IO {
    constructor(body) {
        super(body);
        this.myGoal = {
            x: body.master.control.target.x + body.master.x,
            y: body.master.control.target.y + body.master.y
        };
        this.countdown = 5;
    }
    think() {
        if (this.countdown) {
            if (util.getDistance(this.body, this.myGoal) < 1) this.countdown--;
            return {
                goal: {
                    x: this.myGoal.x,
                    y: this.myGoal.y
                }
            };
        }
    }
}
class io_goAwayFromMasterTarget extends IO {
    constructor(body) {
        super(body);
        this.myGoal = {
            x: -body.master.control.target.x + body.master.x,
            y: -body.master.control.target.y + body.master.y
        };
        this.countdown = 5;
    }
    think() {
        if (this.countdown) {
            if (util.getDistance(this.body, this.myGoal) < 1) this.countdown--;
            return {
                goal: {
                    x: this.myGoal.x,
                    y: this.myGoal.y
                }
            };
        }
    }
}
class io_block extends IO {
    constructor(body) {
        super(body);
        this.blockAngle = Math.atan2(body.y - body.master.y, body.x - body.master.x) - Math.atan2(body.master.control.target.y, body.master.control.target.x);
        if (Math.abs(this.blockAngle) === Infinity) this.blockAngle = 0;
        this.myGoal = {
            x: body.master.control.target.x * Math.cos(this.blockAngle) - body.master.control.target.y * Math.sin(this.blockAngle) + body.master.x,
            y: body.master.control.target.x * Math.sin(this.blockAngle) + body.master.control.target.y * Math.cos(this.blockAngle) + body.master.y
        };
        this.countdown = 5;
    }
    think() {
        if (this.countdown) {
            if (util.getDistance(this.body, this.myGoal) < 1) this.countdown--;
            return {
                goal: {
                    x: this.myGoal.x,
                    y: this.myGoal.y
                }
            };
        }
    }
}
class io_triBoomerang extends IO {
    constructor(b) {
        super(b);
        this.r = 0;
        this.b = b;
        this.m = b.master;
        this.turnover = false;
        let len = 10 * util.getDistance({
            x: 0,
            y: 0
        }, b.master.control.target);
        this.boomAngle = Math.atan2(b.y - b.master.y, b.x - b.master.x) - Math.atan2(b.master.control.target.y, b.master.control.target.x);
        if (Math.abs(this.boomAngle) === Infinity) this.boomAngle = 0;
        this.myGoal = {
            x: 3 * b.master.control.target.x * Math.cos(this.boomAngle) - 3 * b.master.control.target.y * Math.sin(this.boomAngle) + b.master.x,
            y: 3 * b.master.control.target.x * Math.sin(this.boomAngle) + 3 * b.master.control.target.y * Math.cos(this.boomAngle) + b.master.y,
        };
    }
    think(input) {
        if (this.b.range > this.r) this.r = this.b.range;
        let t = 1;
        if (!this.turnover) {
            if (this.r && this.b.range < this.r * .5) this.turnover = true;
            return {
                goal: this.myGoal,
                power: t
            };
        } else return {
            goal: {
                x: this.m.x,
                y: this.m.y
            },
            power: t
        };
    }
}
class io_canRepel extends IO {
    constructor(b) {
        super(b);
    }
    think(input) {
        if (input.alt && input.target) return {
            target: {
                x: -input.target.x,
                y: -input.target.y
            },
            main: true
        };
    }
}
class io_alwaysFire extends IO {
    constructor(body) {
        super(body);
    }
    think() {
        return {
            fire: true
        };
    }
}
class io_targetSelf extends IO {
    constructor(body) {
        super(body);
    }
    think() {
        return {
            main: true,
            target: {
                x: 0,
                y: 0
            }
        };
    }
}
class io_mapAltToFire extends IO {
    constructor(body) {
        super(body);
    }
    think(input) {
        if (input.alt) return {
            fire: true
        };
    }
}
class io_onlyAcceptInArc extends IO {
    constructor(body) {
        super(body);
    }
    think(input) {
        if (input.target && this.body.firingArc != null && (Math.abs(util.angleDifference(Math.atan2(input.target.y, input.target.x), this.body.firingArc[0])) >= this.body.firingArc[1])) return {
            fire: false,
            alt: false,
            main: false
        };
    }
}
class io_nearestDifferentMaster extends IO {
    constructor(body) {
        super(body);
        this.targetLock = undefined;
        this.tick = ran.irandom(30);
        this.lead = 0;
        this.validTargets = this.buildList(body.fov);
        this.oldHealth = body.health.display();
    }
    buildList(range) {
        let m = {
                x: this.body.x,
                y: this.body.y
            },
            mm = {
                x: this.body.master.x,
                y: this.body.master.y
            },
            mostDangerous = 0,
            sqrRange = range * range,
            keepTarget = false;
        let out = entities.map(o => {
            if (!o.isDead() && !o.invuln && !o.passive && !isNaN(o.dangerValue) && (this.body.isArenaCloser || o.alpha > .2) &&
                o.master.master.team !== this.body.master.master.team && o.master.master.team !== -101 &&
                (o.type === "miniboss" || o.type === "tank" || o.type === "crasher" || (!this.body.aiSettings.IGNORE_SHAPES && o.type === "food")) &&
                Math.abs(o.x - m.x) < range && Math.abs(o.y - m.y) < range &&
                (this.body.aiSettings.BLIND || (Math.abs(o.x - mm.x) < range * 2 && Math.abs(o.y - mm.y) < range * 2))) return o;
        }).filter(o => o);
        if (!out.length) return [];
        out = out.map(o => {
            let shoot = false;
            if (Math.pow(this.body.x - o.x, 2) + Math.pow(this.body.y - o.y, 2) < sqrRange) {
                if (this.body.firingArc == null || this.body.aiSettings.FULL_VIEW) shoot = true;
                else if (Math.abs(util.angleDifference(util.getDirection(this.body, o), this.body.firingArc[0])) < this.body.firingArc[1]) shoot = true;
            }
            if (shoot) {
                mostDangerous = Math.max(o.dangerValue, mostDangerous);
                return o;
            }
        }).filter(o => {
            if (o != null && (this.body.aiSettings.FARMER || o.dangerValue === mostDangerous)) {
                if (this.targetLock && o.id === this.targetLock.id) keepTarget = true;
                return o;
            }
        });
        if (!keepTarget) this.targetLock = undefined;
        return out;
    }
    think(input) {
        if (input.main || input.alt || this.body.master.autoOverride) {
            this.targetLock = undefined;
            return {};
        }
        let tracking = this.body.topSpeed,
            range = this.body.fov;
        for (let i = 0; i < this.body.guns.length; i++)
            if (this.body.guns[i].canShoot && !this.body.aiSettings.SKYNET) {
                let v = this.body.guns[i].getTracking();
                tracking = v.speed;
                if (this.body.isBot) range = 640 * this.body.FOV;
                else range = Math.min(range, (v.speed || 1) * (v.range || 90));
                break;
            }
        if (this.targetLock && this.targetLock.isDead()) {
            this.targetLock = undefined;
            this.tick = 100;
        }
        if (this.tick++ > 15 * room.speed) {
            this.tick = 0;
            this.validTargets = this.buildList(this.body.isBot ? range * .875 : range);
            if (this.targetLock && this.validTargets.indexOf(this.targetLock) === -1) this.targetLock = undefined;
            if (this.targetLock == null && this.validTargets.length) {
                this.targetLock = this.validTargets.length === 1 ? this.validTargets[0] : nearest(this.validTargets, {
                    x: this.body.x,
                    y: this.body.y
                });
                this.tick = -90;
            }
        }
        if (this.body.isBot) {
            let damageRef = this.body.bond || this.body;
            if (damageRef.collisionArray.length && damageRef.health.display() < this.oldHealth) {
                this.oldHealth = damageRef.health.display();
                if (this.validTargets.indexOf(damageRef.collisionArray[0]) === -1) this.targetLock = damageRef.collisionArray[0].master.id === -1 ? damageRef.collisionArray[0].source : damageRef.collisionArray[0].master;
            }
        }
        if (this.targetLock != null) {
            let radial = this.targetLock.velocity,
                diff = {
                    x: this.targetLock.x - this.body.x,
                    y: this.targetLock.y - this.body.y
                };
            if (this.tick % 4 === 0) {
                this.lead = 0;
                if (!this.body.aiSettings.CHASE) this.lead = timeOfImpact(diff, radial, tracking);
            }
            return {
                target: {
                    x: diff.x + this.lead * radial.x,
                    y: diff.y + this.lead * radial.y
                },
                fire: true,
                main: true
            };
        }
        return {};
    }
}
class io_minion extends IO {
    constructor(body) {
        super(body);
        this.turnwise = 1;
    }
    think(input) {
        if (input.target != null && (input.alt || input.main)) {
            let sizeFactor = Math.sqrt(this.body.master.size / this.body.master.SIZE),
                leash = 60 * sizeFactor,
                orbit = 120 * sizeFactor,
                repel = 135 * sizeFactor,
                goal,
                power = 1,
                target = new Vector(input.target.x, input.target.y);
            if (input.alt) {
                if (target.length < leash) goal = {
                    x: this.body.x + target.x,
                    y: this.body.y + target.y
                };
                else if (target.length < repel) {
                    let dir = -this.turnwise * target.direction + Math.PI / 5;
                    goal = {
                        x: this.body.x + Math.cos(dir),
                        y: this.body.y + Math.sin(dir)
                    };
                } else goal = {
                    x: this.body.x - target.x,
                    y: this.body.y - target.y
                };
            } else if (input.main) {
                let dir = this.turnwise * target.direction + .01;
                goal = {
                    x: this.body.x + target.x - orbit * Math.cos(dir),
                    y: this.body.y + target.y - orbit * Math.sin(dir)
                };
                if (Math.abs(target.length - orbit) < this.body.size * 2) power = .7;
            }
            return {
                goal: goal,
                power: power
            };
        }
    }
}
class io_hangOutNearMaster extends IO {
    constructor(body) {
        super(body);
        this.acceptsFromTop = false;
        this.orbit = 30;
        this.currentGoal = {
            x: this.body.source.x,
            y: this.body.source.y
        };
        this.timer = 0;
    }
    think(input) {
        if (this.body.source !== this.body) {
            let bound1 = this.orbit * .8 + this.body.source.size + this.body.size,
                bound2 = this.orbit * 1.5 + this.body.source.size + this.body.size,
                dist = util.getDistance(this.body, this.body.source) + Math.PI / 8,
                output = {
                    target: {
                        x: this.body.velocity.x,
                        y: this.body.velocity.y
                    },
                    goal: this.currentGoal,
                    power: undefined
                };
            if (dist > bound2 || this.timer > 30) {
                this.timer = 0;
                let dir = util.getDirection(this.body, this.body.source) + Math.PI * ran.random(.5),
                    len = ran.randomRange(bound1, bound2),
                    x = this.body.source.x - len * Math.cos(dir),
                    y = this.body.source.y - len * Math.sin(dir);
                this.currentGoal = {
                    x: x,
                    y: y
                };
            }
            if (dist < bound2) {
                output.power = .15;
                if (ran.chance(.3)) this.timer++;
            }
            return output;
        }
    }
}
class io_spin extends IO {
    constructor(b) {
        super(b);
        this.a = 0;
    }
    think(input) {
        this.a += .05;
        let offset = 0;
        if (this.body.bond != null) offset = this.body.bound.angle;
        return {
            target: {
                x: Math.cos(this.a + offset),
                y: Math.sin(this.a + offset)
            },
            main: true
        };
    }
}
class io_slowSpin extends IO {
    constructor(b) {
        super(b);
        this.a = 0;
    }
    think(input) {
        this.a += .025;
        let offset = 0;
        if (this.body.bond != null) offset = this.body.bound.angle;
        return {
            target: {
                x: Math.cos(this.a + offset),
                y: Math.sin(this.a + offset)
            },
            main: true
        };
    }
}
class io_slowSpinReverse extends IO {
    constructor(b) {
        super(b);
        this.a = 0;
    }
    think(input) {
        this.a -= .025;
        let offset = 0;
        if (this.body.bond != null) offset = this.body.bound.angle;
        return {
            target: {
                x: Math.cos(this.a + offset),
                y: Math.sin(this.a + offset)
            },
            main: true
        };
    }
}
class io_slowSpin2 extends IO {
    constructor(b) {
        super(b);
    }
    think(input) {
        this.body.facing += .00375;
        return {
            target: {
                x: Math.cos(this.body.facing),
                y: Math.sin(this.body.facing)
            },
            main: true
        };
    }
}
class io_fastSpin extends IO {
    constructor(b) {
        super(b);
        this.a = 0;
    }
    think(input) {
        this.a += .072;
        let offset = 0;
        if (this.body.bond != null) offset = this.body.bound.angle;
        return {
            target: {
                x: Math.cos(this.a + offset),
                y: Math.sin(this.a + offset)
            },
            main: true
        };
    }
}
class io_heliSpin extends IO {
    constructor(b) {
        super(b);
        this.a = 0;
    }
    think(input) {
        this.a += Math.PI / 5.5;
        let offset = 0;
        if (this.body.bond != null) offset = this.body.bound.angle;
        return {
            target: {
                x: Math.cos(this.a + offset),
                y: Math.sin(this.a + offset)
            },
            main: true
        };
    }
}
class io_reverseSpin extends IO {
    constructor(b) {
        super(b);
        this.a = 0;
    }
    think(input) {
        this.a -= .05;
        let offset = 0;
        if (this.body.bond != null) offset = this.body.bound.angle;
        return {
            target: {
                x: Math.cos(this.a + offset),
                y: Math.sin(this.a + offset)
            },
            main: true
        };
    }
}
class io_reverseFastSpin extends IO {
    constructor(b) {
        super(b);
        this.a = 0;
    }
    think(input) {
        this.a -= .072;
        let offset = 0;
        if (this.body.bond != null) offset = this.body.bound.angle;
        return {
            target: {
                x: Math.cos(this.a + offset),
                y: Math.sin(this.a + offset)
            },
            main: true
        };
    }
}
class io_reverseHeliSpin extends IO {
    constructor(b) {
        super(b);
        this.a = 0;
    }
    think(input) {
        this.a -= Math.PI / 5.5;
        let offset = 0;
        if (this.body.bond != null) offset = this.body.bound.angle;
        return {
            target: {
                x: Math.cos(this.a + offset),
                y: Math.sin(this.a + offset)
            },
            main: true
        };
    }
}
class io_dontTurn extends IO {
    constructor(b) {
        super(b);
    }
    think(input) {
        return {
            target: {
                x: 1,
                y: 0
            },
            main: true
        };
    }
}
class io_dontTurn2 extends IO {
    constructor(b) {
        super(b);
    }
    think(input) {
        return {
            target: {
                x: 0,
                y: 1
            },
            main: true
        };
    }
}
class io_spinWhileIdle extends IO {
    constructor(b) {
        super(b);
        this.a = 0;
    }
    think(input) {
        if (input.target) {
            this.a = Math.atan2(input.target.y, input.target.x);
            return input;
        }
        this.a += .015;
        return {
            target: {
                x: Math.cos(this.a),
                y: Math.sin(this.a)
            },
            main: true
        };
    }
}
class io_fleeAtLowHealth extends IO {
    constructor(b) {
        super(b);
        this.fear = util.clamp(ran.gauss(.7, .15), .1, .9) * .75;
    }
    think(input) {
        if (input.fire && input.target != null && this.body.health.amount < this.body.health.max * this.fear) return {
            goal: {
                x: this.body.x - input.target.x,
                y: this.body.y - input.target.y
            }
        };
    }
}
class io_fleeAtLowHealth2 extends IO {
    constructor(b) {
        super(b);
        this.fear = util.clamp(ran.gauss(.7, .15), .1, .9) * .45;
    }
    think(input) {
        if (input.fire && input.target != null && this.body.health.amount < this.body.health.max * this.fear) return {
            goal: {
                x: this.body.x - input.target.x,
                y: this.body.y - input.target.y
            },
            target: {
                x: this.body.velocity.x,
                y: this.body.velocity.y
            }
        };
    }
}
class io_orion extends IO {
    constructor(b) {
        super(b);
        this.turnwise = 1;
        this.r = 0;
        this.turnover = false;
    }
    think(input) {
        let sizeFactor = Math.sqrt(this.body.master.size / this.body.master.SIZE),
            orbit = 45 * sizeFactor,
            power = 1;
        this.body.x += this.body.source.velocity.x;
        this.body.y += this.body.source.velocity.y;
        let dir = this.turnwise * util.getDirection(this.body, this.body.source) + .01,
            goal = {
                x: this.body.source.x - orbit * Math.cos(dir),
                y: this.body.source.y - orbit * Math.sin(dir)
            };
        return {
            goal: goal,
            power: power
        };
    }
}
class io_sizething extends IO {
    constructor(b) {
        super(b);
        this.div = 20;
        this.origS = 230;
        this.time = this.div;
    }
    think(input) {
        this.body.SIZE = this.time * this.origS * (1 / this.div);
        if (this.body.SIZE <= 0) this.body.kill();
        this.time--;
    }
}
class io_rlyfastspin2 extends IO {
    constructor(b) {
        super(b);
        this.a = 360 * Math.random();
        this.b = 31 * (Math.sin(Math.PI * Math.round(-1 + Math.random()) + Math.PI / 2));
    }
    think(input) {
        this.a += this.b * Math.PI / 180;
        let offset = 0;
        if (this.body.bond != null) offset = 0;
        return {
            target: {
                x: Math.cos(this.a + offset),
                y: Math.sin(this.a + offset),
            },
            main: true,
        };
    }
}
class io_mRot extends IO {
    constructor(b) {
        super(b);
    }
    think(input) {
        return {
            target: {
                x: this.body.master.control.target.x,
                y: this.body.master.control.target.y,
            },
            main: true,
        };
    }
}
class io_sineA extends IO {
    constructor(b) {
        super(b);
        this.phase = 5;
        this.wo = this.body.master.facing;
    }
    think(input) {
        this.phase += .5;
        this.body.x += this.phase * Math.cos(this.wo) - 10 * Math.cos(this.phase) * Math.sin(this.wo);
        this.body.y += this.phase * Math.sin(this.wo) + 10 * Math.cos(this.phase) * Math.cos(this.wo);
        return {
            power: 1
        };
    }
}
class io_sineB extends IO {
    constructor(b) {
        super(b);
        this.phase = 5;
        this.wo = this.body.master.facing;
    }
    think(input) {
        this.phase += .5;
        this.body.x += this.phase * Math.cos(this.wo) + 10 * Math.cos(this.phase) * Math.sin(this.wo);
        this.body.y += this.phase * Math.sin(this.wo) - 10 * Math.cos(this.phase) * Math.cos(this.wo);
    }
}
class io_sineC extends IO {
    constructor(b) {
        super(b);
        this.phase = -5;
        this.wo = this.body.master.facing;
    }
    think(input) {
        this.phase -= .5;
        this.body.x += this.phase * Math.cos(this.wo) + 10 * Math.cos(this.phase) * Math.sin(this.wo);
        this.body.y += this.phase * Math.sin(this.wo) - 10 * Math.cos(this.phase) * Math.cos(this.wo);
        return {
            power: 1
        };
    }
}
class io_sineD extends IO {
    constructor(b) {
        super(b);
        this.phase = -5;
        this.wo = this.body.master.facing;
    }
    think(input) {
        this.phase -= .5;
        this.body.x += this.phase * Math.cos(this.wo) - 10 * Math.cos(this.phase) * Math.sin(this.wo);
        this.body.y += this.phase * Math.sin(this.wo) + 10 * Math.cos(this.phase) * Math.cos(this.wo);
    }
}
class io_portal extends IO {
    constructor(body) {
        super(body);
        this.myGoal = {
            x: body.master.control.target.x + body.master.x,
            y: body.master.control.target.y + body.master.y
        };
    }
    think() {
        this.body.x = this.myGoal.x;
        this.body.y = this.myGoal.y;
        return {
            goal: {
                x: this.myGoal.x,
                y: this.myGoal.y
            }
        };
    }
}

const skcnv = {
    rld: 0,
    pen: 1,
    str: 2,
    dam: 3,
    spd: 4,
    shi: 5,
    atk: 6,
    hlt: 7,
    rgn: 8,
    mob: 9
};
const levelers = [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
    23, 24, 25, 26, 27, 28, 29, 30, 32, 34,
    36, 38, 40, 42, 44, 46, 48, 50, 55, 60
];

class Skill {
    constructor(inital = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) {
        this.raw = inital;
        this.caps = [];
        this.setCaps([c.MAX_SKILL, c.MAX_SKILL, c.MAX_SKILL, c.MAX_SKILL, c.MAX_SKILL, c.MAX_SKILL, c.MAX_SKILL, c.MAX_SKILL, c.MAX_SKILL, c.MAX_SKILL]);
        this.name = [
            "Reload",
            "Bullet Penetration",
            "Bullet Health",
            "Bullet Damage",
            "Bullet Speed",
            "Shield Capacity",
            "Body Damage",
            "Max Health",
            "Shield Regeneration",
            "Movement Speed"
        ];
        this.atk = 0;
        this.hlt = 0;
        this.spd = 0;
        this.str = 0;
        this.pen = 0;
        this.dam = 0;
        this.rld = 0;
        this.mob = 0;
        this.rgn = 0;
        this.shi = 0;
        this.rst = 0;
        this.brst = 0;
        this.ghost = 0;
        this.acl = 0;
        this.reset();
    }
    reset() {
        this.points = 0;
        this.score = 0;
        this.deduction = 0;
        this.level = 0;
        this.canUpgrade = false;
        this.update();
        this.maintain();
    }
    update() {
        const curve = (() => {
            const make = x => Math.log(4 * x + 1) / Math.log(5);
            let a = [];
            for (let i = 0; i < c.MAX_SKILL * 2; i++) a.push(make(i / c.MAX_SKILL));
            return x => a[x * c.MAX_SKILL];
        })();
        const apply = (f, x) => x < 0 ? 1 / (1 - x * f) : f * x + 1;
        for (let i = 0; i < 10; i++)
            if (this.raw[i] > this.caps[i]) {
                this.points += this.raw[i] - this.caps[i];
                this.raw[i] = this.caps[i];
            }
        let attrib = [];
        for (let i = 0; i < 5; i++)
            for (let j = 0; j < 2; j++) attrib[i + 5 * j] = curve((this.raw[i + 5 * j] + this.bleed(i, j)) / c.MAX_SKILL);
        this.rld = Math.pow(.5, attrib[skcnv.rld]);
        this.pen = apply(2.7, attrib[skcnv.pen]);
        this.str = apply(2.2, attrib[skcnv.str]);
        this.dam = apply(3.19, attrib[skcnv.dam]);
        this.spd = .5 + apply(1.485, attrib[skcnv.spd]);
        this.acl = apply(.5, attrib[skcnv.rld]);
        this.rst = .5 * attrib[skcnv.str] + 2.5 * attrib[skcnv.pen];
        this.ghost = attrib[skcnv.pen];
        this.shi = apply(.3, attrib[skcnv.shi]);
        this.atk = apply(.021, attrib[skcnv.atk]);
        this.hlt = apply(.105, attrib[skcnv.hlt]);
        this.mob = apply(.79, attrib[skcnv.mob]);
        this.rgn = apply(10, attrib[skcnv.rgn]);
        this.brst = .3 * (.5 * attrib[skcnv.atk] + .5 * attrib[skcnv.hlt] + attrib[skcnv.rgn]);
    }
    set(thing) {
        this.raw[0] = thing[0];
        this.raw[1] = thing[1];
        this.raw[2] = thing[2];
        this.raw[3] = thing[3];
        this.raw[4] = thing[4];
        this.raw[5] = thing[5];
        this.raw[6] = thing[6];
        this.raw[7] = thing[7];
        this.raw[8] = thing[8];
        this.raw[9] = thing[9];
        this.update();
    }
    setCaps(thing) {
        this.caps[0] = thing[0];
        this.caps[1] = thing[1];
        this.caps[2] = thing[2];
        this.caps[3] = thing[3];
        this.caps[4] = thing[4];
        this.caps[5] = thing[5];
        this.caps[6] = thing[6];
        this.caps[7] = thing[7];
        this.caps[8] = thing[8];
        this.caps[9] = thing[9];
        this.update();
    }
    maintain() {
        if (this.level < c.SKILL_CAP && this.score - this.deduction >= this.levelScore) {
            this.deduction += this.levelScore;
            this.level += 1;
            this.points += this.levelPoints;
            if (this.level === 15 || this.level === 30 || this.level === 45 || this.level === 60) this.canUpgrade = true;
            this.update();
            return true;
        }
        return false;
    }
    get levelScore() {
        return Math.ceil(1.8 * Math.pow(this.level + 1, 1.8) - 2 * this.level + 1);
    }
    get progress() {
        return this.levelScore ? (this.score - this.deduction) / this.levelScore : 0;
    }
    get levelPoints() {
        if (levelers.indexOf(this.level) !== -1) return 1;
        return 0;
    }
    cap(skill, real = false) {
        if (!real && this.level < c.SKILL_SOFT_CAP) return Math.round(this.caps[skcnv[skill]] * c.SOFT_MAX_SKILL);
        return this.caps[skcnv[skill]];
    }
    bleed(i, j) {
        let a = (i + 2) % 5 + 5 * j,
            b = (i + (j === 1 ? 1 : 4)) % 5 + 5 * j,
            value = 0,
            denom = Math.max(c.MAX_SKILL, this.caps[i + 5 * j]);
        value += (1 - Math.pow(this.raw[a] / denom - 1, 2)) * this.raw[a] * c.SKILL_LEAK;
        value -= Math.pow(this.raw[b] / denom, 2) * this.raw[b] * c.SKILL_LEAK;
        return value;
    }
    upgrade(stat) {
        if (this.points && this.amount(stat) < this.cap(stat)) {
            this.change(stat, 1);
            this.points -= 1;
            return true;
        }
        return false;
    }
    title(stat) {
        return this.name[skcnv[stat]];
    }
    amount(skill) {
        return this.raw[skcnv[skill]];
    }
    change(skill, levels) {
        this.raw[skcnv[skill]] += levels;
        this.update();
    }
}

const realSizes = (() => {
    let o = [1, 1, 1];
    for (let i = 3; i < 17; i++) o.push(Math.sqrt((2 * Math.PI / i) * (1 / Math.sin(2 * Math.PI / i))));
    return o;
})();

class Gun {
    constructor(body, info) {
        this.lastShot = {
            time: 0,
            power: 0
        };
        this.body = body;
        this.master = body.source;
        this.label = "";
        this.controllers = [];
        this.children = [];
        this.control = {
            target: new Vector(0, 0),
            goal: new Vector(0, 0),
            main: false,
            alt: false,
            fire: false
        };
        this.canShoot = false;
        this.skin = 0;
        this.color_unmix = 0;
        this.color = 16;
        this.colorOverride = null;
        this.shootOnDeath = false;
        let PROPERTIES = info.PROPERTIES;
        if (PROPERTIES != null && PROPERTIES.TYPE != null) {
            this.canShoot = true;
            this.label = PROPERTIES.LABEL || "";
            if (Array.isArray(PROPERTIES.TYPE)) {
                this.bulletTypes = PROPERTIES.TYPE;
                this.natural = PROPERTIES.TYPE.BODY;
            } else this.bulletTypes = [PROPERTIES.TYPE];
            let natural = {};
            const setNatural = type => {
                if (type.PARENT != null)
                    for (let i = 0; i < type.PARENT.length; i++) setNatural(type.PARENT[i]);
                if (type.BODY != null)
                    for (let index in type.BODY) natural[index] = type.BODY[index];
            };
            for (let type of this.bulletTypes) setNatural(type);
            this.natural = natural;
            this.autofire = PROPERTIES.AUTOFIRE == null ? false : PROPERTIES.AUTOFIRE;
            this.altFire = PROPERTIES.ALT_FIRE == null ? false : PROPERTIES.ALT_FIRE;
            this.duoFire = PROPERTIES.DUO_FIRE == null ? false : PROPERTIES.DUO_FIRE;
            this.settings = PROPERTIES.SHOOT_SETTINGS || [];
            this.onShoot = PROPERTIES.ON_SHOOT;
            this.inject = PROPERTIES.INJECT;
            this.calculator = PROPERTIES.STAT_CALCULATOR || "default";
            this.waitToCycle = PROPERTIES.WAIT_TO_CYCLE == null ? false : PROPERTIES.WAIT_TO_CYCLE;
            this.countsOwnKids = PROPERTIES.MAX_CHILDREN == null ? false : PROPERTIES.MAX_CHILDREN;
            this.syncsSkills = PROPERTIES.SYNCS_SKILLS == null ? false : PROPERTIES.SYNCS_SKILLS;
            this.useHealthStats = PROPERTIES.USE_HEALTH_STATS == null ? false : PROPERTIES.USE_HEALTH_STATS;
            this.negRecoil = PROPERTIES.NEGATIVE_RECOIL == null ? false : PROPERTIES.NEGATIVE_RECOIL;
            this.destroyOldestChild = PROPERTIES.DESTROY_OLDEST_CHILD == null ? false : PROPERTIES.DESTROY_OLDEST_CHILD;
            this.shootOnDeath = PROPERTIES.SHOOT_ON_DEATH == null ? false : PROPERTIES.SHOOT_ON_DEATH;
            if (this.shootOnDeath) this.body.onDead = () => {
                let self = this;
                for (let i = 0; i < self.body.guns.length; i++) {
                    let gun = self.body.guns[i];
                    if (gun.shootOnDeath) {
                        let gx = gun.offset * Math.cos(gun.direction + gun.angle + gun.body.facing) + (1.5 * gun.length - gun.width * gun.settings.size / 2) * Math.cos(gun.angle + self.body.facing),
                            gy = gun.offset * Math.sin(gun.direction + gun.angle + gun.body.facing) + (1.5 * gun.length - gun.width * gun.settings.size / 2) * Math.sin(gun.angle + self.body.facing);
                        gun.fire(gx, gy, self.body.skill);
                    }
                }
            };
            if (PROPERTIES.COLOR_OVERRIDE != null) this.colorOverride = PROPERTIES.COLOR_OVERRIDE;
        }
        if (PROPERTIES != null && PROPERTIES.COLOR != null) this.color = PROPERTIES.COLOR;
        if (PROPERTIES != null && PROPERTIES.COLOR_UNMIX != null) this.color_unmix = PROPERTIES.COLOR_UNMIX;
        if (PROPERTIES != null && PROPERTIES.SKIN != null) this.skin = PROPERTIES.SKIN;
        let position = info.POSITION;
        this.length = position[0] / 10;
        this.width = position[1] / 10;
        this.aspect = position[2];
        let offset = new Vector(position[3], position[4]);
        this.angle = position[5] * Math.PI / 180;
        this.direction = offset.direction;
        this.offset = offset.length / 10;
        this.delay = position[6];
        this.position = 0;
        this.motion = 0;
        if (this.canShoot) {
            this.cycle = !this.waitToCycle - this.delay;
            this.trueRecoil = this.settings.recoil;
        }
    }
    recoil() {
        if (this.motion || this.position) {
            this.motion -= .25 * this.position / room.speed;
            this.position += this.motion;
            if (this.position < 0) {
                this.position = 0;
                this.motion = -this.motion;
            }
            if (this.motion > 0) this.motion *= .75;
        }
        if (this.canShoot && !this.body.settings.hasNoRecoil && this.motion > 0) {
            let recoilForce = -this.position * this.trueRecoil * .045 / room.speed;
            this.body.accel.x += recoilForce * Math.cos(this.body.facing + this.angle);
            this.body.accel.y += recoilForce * Math.sin(this.body.facing + this.angle);
        }
    }
    getSkillRaw() {
        return [ // Not this one
            this.body.skill.raw[0],
            this.body.skill.raw[1],
            this.body.skill.raw[2],
            this.body.skill.raw[3],
            this.body.skill.raw[4],
            0,
            0,
            0,
            0,
            0
        ];
    }
    getLastShot() {
        return this.lastShot;
    }
    live() {
        this.recoil();
        if (this.canShoot) {
            let sk = this.body.skill,
                shootPermission = this.countsOwnKids ? this.countsOwnKids > this.children.length * (this.calculator === 7 ? sk.rld : 1) :
                    this.body.maxChildren ? this.body.maxChildren > this.body.children.length * (this.calculator === 7 ? sk.rld : 1) : true;
            if (this.destroyOldestChild) {
                if (!shootPermission) shootPermission = true;
                this.destroyOldest();
            }
            if (this.body.master.invuln) shootPermission = false;
            if ((shootPermission || !this.waitToCycle) && this.cycle < 1) this.cycle += 1 / this.settings.reload / room.speed / (this.calculator === 7 || this.calculator === 4 ? 1 : sk.rld);
            if (shootPermission && (this.autofire || (this.duoFire ? this.body.control.alt || this.body.control.fire : this.altFire ? this.body.control.alt : this.body.control.fire))) {
                if (this.cycle >= 1) {
                    let gx = this.offset * Math.cos(this.direction + this.angle + this.body.facing) + (1.5 * this.length - this.width * this.settings.size / 2) * Math.cos(this.angle + this.body.facing),
                        gy = this.offset * Math.sin(this.direction + this.angle + this.body.facing) + (1.5 * this.length - this.width * this.settings.size / 2) * Math.sin(this.angle + this.body.facing);
                    while (shootPermission && this.cycle >= 1) {
                        if (!this.body.master.emp.active) this.fire(gx, gy, sk);
                        shootPermission = this.countsOwnKids ? this.countsOwnKids > this.children.length : this.body.maxChildren ? this.body.maxChildren > this.body.children.length : true;
                        this.cycle -= 1;
                        if (this.onShoot != null && this.body.master.isAlive()) this.body.master.runAnimations(this);
                    }
                }
            } else if (this.cycle > !this.waitToCycle - this.delay) this.cycle = !this.waitToCycle - this.delay;
        }
    }
    destroyOldest() {
        let toKill = this.children.length - this.countsOwnKids;
        for (let i = 0; i < toKill; i++) {
            let child = this.children[i];
            if (child) child.kill();
        }
    }
    syncChildren() {
        if (this.syncsSkills) {
            let self = this;
            for (let o of this.children) {
                o.define({
                    BODY: self.interpret(),
                    SKILL: self.getSkillRaw()
                });
                o.refreshBodyAttributes();
            }
        }
    }
    fire(gx, gy, sk) {
        this.lastShot.time = util.time();
        this.lastShot.power = 3 * Math.log(Math.sqrt(sk.spd) + this.trueRecoil + 1) + 1;
        this.motion += this.lastShot.power;
        let ss,
            sd;
        do ss = ran.gauss(0, Math.sqrt(this.settings.shudder, 1));
        while (Math.abs(ss) >= 2 * this.settings.shudder);
        do sd = ran.gauss(0, this.settings.spray * this.settings.shudder, 1);
        while (Math.abs(sd) >= .5 * this.settings.spray);
        sd *= Math.PI / 180;
        let s = new Vector(
            (this.negRecoil ? -1 : 1) * this.settings.speed * c.runSpeed * sk.spd * (1 + ss) * Math.cos(this.angle + this.body.facing + sd),
            (this.negRecoil ? -1 : 1) * this.settings.speed * c.runSpeed * sk.spd * (1 + ss) * Math.sin(this.angle + this.body.facing + sd)
        );
        if (this.body.velocity.length) {
            let extraBoost = Math.max(0, s.x * this.body.velocity.x + s.y * this.body.velocity.y) / this.body.velocity.length / s.length;
            if (extraBoost) {
                let len = s.length;
                s.x += this.body.velocity.length * extraBoost * s.x / len;
                s.y += this.body.velocity.length * extraBoost * s.y / len;
            }
        }
        let o = new Entity({
            x: this.body.x + this.body.size * gx - .75 * this.length * s.x,
            y: this.body.y + this.body.size * gy - .75 * this.length * s.y
        }, this.master.master);
        o.velocity = s;
        this.bulletInit(o);
        o.coreSize = o.SIZE;
    }
    bulletInit(o) {
        o.diesToTeamBase = !this.body.master.godmode;
        o.passive = this.body.master.passive;
        if (this.colorOverride === "rainbow") o.toggleRainbow();
        for (let type of this.bulletTypes) o.define(type);
        o.define({
            BODY: this.interpret(),
            SKILL: this.getSkillRaw(),
            SIZE: this.body.size * this.width * this.settings.size / 2,
            LABEL: this.master.label + (this.label ? " " + this.label : "") + " " + o.label
        });
        if (this.colorOverride != null && !isNaN(this.colorOverride)) o.color = this.colorOverride;
        else if (this.colorOverride === "random") o.color = Math.floor(42 * Math.random());
        else o.color = this.body.master.color;
        if (this.countsOwnKids) {
            o.parent = this;
            this.children.push(o);
        } else if (this.body.maxChildren) {
            o.parent = this.body;
            this.body.children.push(o);
            this.children.push(o);
        }
        o.source = this.body;
        o.facing = o.velocity.direction;
        let oo = o;
        if (this.calculator === 7) o.necro = host => {
            let shootPermission = this.countsOwnKids ? this.countsOwnKids > this.children.length * this.body.skill.rld :
                this.body.maxChildren ? this.body.maxChildren > this.body.children.length * this.body.skill.rld : true;
            if (shootPermission && host.sanctuaryType === "None" && !host.label.includes("Sanctuary")) {
                let save = {
                    facing: host.facing,
                    size: oo.shape === 5 ? oo.SIZE + .4 * Math.random() : host.SIZE > 14 ? 14 : host.SIZE
                };
                host.define(Class.genericEntity);
                this.bulletInit(host);
                host.team = oo.master.master.team;
                host.master = oo.master;
                host.color = oo.color;
                host.facing = save.facing;
                host.SIZE = save.size; // oo.size
                host.health.amount = host.health.max;
                return true;
            }
            return false;
        };
        o.refreshBodyAttributes();
        o.life();
    }
    getTracking() {
        return {
            speed: c.runSpeed * this.body.skill.spd * this.settings.maxSpeed * this.natural.SPEED,
            range: Math.sqrt(this.body.skill.spd) * this.settings.range * this.natural.RANGE
        };
    }
    interpret() {
        let sizeFactor = this.master.size / this.master.SIZE,
            shoot = this.settings,
            sk = this.body.skill,
            out = {
                SPEED: shoot.maxSpeed * sk.spd,
                HEALTH: shoot.health * sk.str,
                RESIST: shoot.resist + sk.rst,
                DAMAGE: shoot.damage * sk.dam,
                PENETRATION: Math.max(1, shoot.pen * sk.pen),
                RANGE: shoot.range / Math.sqrt(sk.spd),
                DENSITY: shoot.density * sk.pen * sk.pen / sizeFactor,
                PUSHABILITY: 1 / sk.pen,
                HETERO: 3 - 2.8 * sk.ghost
            };
        switch (this.calculator) {
            case 6:
            case "sustained":
                out.RANGE = shoot.range;
                break;
            case 8:
            case "trap":
                out.PUSHABILITY = 1 / Math.pow(sk.pen, .5);
                out.RANGE = shoot.range * .5;
                break;
        }
        for (let property in out) {
            if (this.natural[property] == null || !out.hasOwnProperty(property)) continue;
            out[property] *= this.natural[property];
        }
        return out;
    }
}

let minimap = [],
    views = [],
    bots = [],
    entitiesToAvoid = [],
    entities = [],
    bot = null,
    players = [],
    clients = [],
    bannedIPs = [[ // IMPORTANT: Order matters here; match the reason with the IP
        //"2001:67c:2660:425:1d::265", // Multiboxer
        //"::ffff:176.59.70.97", // Multiboxer
        "::ffff:112.120.147.183", // Massively hated hunter
        //"::ffff:80.52.130.235", // Multiboxer
        "2601:600:9d80:3796:5b0:8e4f:b86a:eca5", // Massively hated hunter (ban evasion)
        "::ffff:180.191.168.114", // Massively hated hunter (ban evasion)
        //"::ffff:72.201.69.179", // Extreme racism, saying "George Floyd deserved to die"
        "::ffff:180.191.176.176", // Another massively hated hunter
        "::ffff:174.46.244.136", // Massively hated hunter
        "::ffff:32.211.197.91", // [JS] hunting clan member
        "::ffff:172.88.46.153", // [JS] hunting clan member
        "::ffff:174.46.244.136", // [JS] hunting clan member
        "::ffff:185.230.126.3", // [JS] hunting clan member
        "::ffff:185.236.200.26", // [JS] hunting clan member
        "::ffff:104.129.56.177", // [JS] hunting clan member
        "::ffff:68.235.33.116", // [JS] hunting clan member
        "::ffff:185.230.126.23" // Leader of [JS] clan
    ], [
        //"Multiboxing",
        //"Multiboxing",
        "Repeated witch-hunting (community voted for this ban)",
        //"Multiboxing",
        "Repeated witch-hunting (community voted for this ban, ban evasion)",
        "Repeated witch-hunting (community voted for this ban, ban evasion)",
        //"Racist names, saying George Floyd and blacks deserve to die",
        "Repeated witch-hunting (community voted for this ban)",
        "Repeated witch-hunting (community voted for this ban)",
        "Hunting clan member",
        "Hunting clan member",
        "Hunting clan member",
        "Hunting clan member",
        "Hunting clan member",
        "Hunting clan member",
        "Hunting clan member",
        "Hunting clan leader"
    ]],
    connectedIPs = [],
    entitiesIdLog = 1,
    startingTank = "basic",
    blockedNames = [
        /*"fuck",
        "bitch",
        "cunt",
        "shit",
        "pussy",
        "penis",
        "nigg",
        "penis",
        "dick",
        "whore",
        "dumbass"*/
        "arras is trash",
        "diep > arras"
    ],
    sanctuaries = [],
    grid = new hshg.HSHG();
const dirtyCheck = (p, r) => entitiesToAvoid.some(e => Math.abs(p.x - e.x) < r + e.size && Math.abs(p.y - e.y) < r + e.size);
const purgeEntities = () => {
    entities = entities.filter(e => /*e != null && */!e.isGhost);
};
const bringToLife = (() => {
    const remapTarget = (i, ref, self) => {
        if (i.target == null || (!i.main && !i.alt)) return undefined;
        return {
            x: i.target.x + ref.x - self.x,
            y: i.target.y + ref.y - self.y
        };
    };
    const passer = (a, b, acceptsFromTop) => index => {
        if (a != null && a[index] != null && (b[index] == null || acceptsFromTop)) b[index] = a[index];
    };
    return my => {
        if (my.SIZE !== my.coreSize) {
            my.coreSize = my.SIZE;
            my.refreshFOV();
        }
        let faucet = my.settings.independent || my.source == null || my.source === my ? {} : my.source.control,
            b = {
                target: remapTarget(faucet, my.source, my),
                goal: undefined,
                fire: faucet.fire,
                main: faucet.main,
                alt: faucet.alt,
                power: undefined
            };
        if (my.settings.attentionCraver && !faucet.main && my.range) my.range -= 1;
        for (let AI of my.controllers) {
            let a = AI.think(b),
                passValue = passer(a, b, AI.acceptsFromTop);
            passValue("target");
            passValue("goal");
            passValue("fire");
            passValue("main");
            passValue("alt");
            passValue("power");
        }
        my.control.target = b.target == null ? my.control.target : b.target;
        my.control.goal = b.goal;
        my.control.fire = b.fire;
        my.control.main = b.main;
        my.control.alt = b.alt;
        my.control.power = b.power == null ? 1 : b.power;
        my.move();
        my.face();
        for (let gun of my.guns) gun.live();
        for (let turret of my.turrets) turret.life();
        if (my.skill.maintain()) my.refreshBodyAttributes();
        if (my.invisible[1]) {
            my.alpha = Math.max(my.invisible[2], my.alpha - my.invisible[1]);
            if (my.velocity.isShorterThan(my.velocity, .15) || my.damageReceived) my.alpha = Math.min(1, my.alpha + my.invisible[0]);
        }
    };
})();

class HealthType {
    constructor(health, type, resist = 0) {
        this.max = health;
        this.amount = health;
        this.type = type;
        this.resist = resist;
        this.regen = 0;
    }
    set(health, regen = 0) {
        this.amount = this.max ? this.amount / this.max * health : health;
        this.max = health;
        this.regen = regen;
    }
    display() {
        return this.amount / this.max;
    }
    getDamage(amount, capped = true) {
        switch (this.type) {
            case "dynamic":
                return capped ? Math.min(amount * this.permeability, this.amount) : amount * this.permeability;
            case "static":
                return capped ? Math.min(amount, this.amount) : amount;
        }
    }
    regenerate(boost = false) {
        boost /= 2;
        let mult = c.REGEN_MULTIPLIER;
        switch (this.type) {
            case "static":
                if (this.amount >= this.max || !this.amount) break;
                this.amount += mult * (this.max / 10 / 60 / 2.5 + boost);
                break;
            case "dynamic":
                let r = util.clamp(this.amount / this.max, 0, 1);
                if (!r) this.amount = .0001;
                if (r === 1) this.amount = this.max;
                else this.amount += mult * (this.regen * Math.exp(-50 * Math.pow(Math.sqrt(.5 * r) - .4, 2)) / 3 + r * this.max / 10 / 15 + boost);
                break;
        }
        this.amount = util.clamp(this.amount, 0, this.max);
    }
    get permeability() {
        switch (this.type) {
            case "static":
                return 1;
            case "dynamic":
                return this.max ? util.clamp(this.amount / this.max, 0, 1) : 0;
        }
    }
    get ratio() {
        return this.max ? util.clamp(1 - Math.pow(this.amount / this.max - 1, 4), 0, 1) : 0;
    }
}
class Entity {
    constructor(position, master = this) {
        this.isGhost = false;
        this.killCount = {
            solo: 0,
            assists: 0,
            bosses: 0,
            killers: []
        };
        this.creationTime = (new Date()).getTime();
        this.master = master;
        this.source = this;
        this.parent = this;
        this.control = {
            target: new Vector(0, 0),
            goal: new Vector(0, 0),
            main: false,
            alt: false,
            fire: false,
            power: 0
        };
        this.isInGrid = false;
        this.activation = (() => {
            let active = true,
                timer = ran.irandom(15);
            return {
                update: () => {
                    if (this.isDead()) return 0;
                    if (!active) {
                        this.removeFromGrid();
                        if (this.settings.diesAtRange) this.kill();
                        if (!(timer--)) active = true;
                    } else {
                        this.addToGrid();
                        timer = 15;
                        active = this.alwaysActive || (this.source && this.source.player || views.some(a => a.check(this, .6)));
                    }
                },
                check: () => active
            };
        })();
        this.autoOverride = false;
        this.controllers = [];
        this.blend = {
            color: "#FFFFFF",
            amount: 0
        };
        this.skill = new Skill();
        this.health = new HealthType(1, "static", 0);
        this.shield = new HealthType(0, "dynamic");
        this.guns = [];
        this.turrets = [];
        this.upgrades = [];
        this.settings = {};
        this.aiSettings = {};
        this.children = [];
        this.SIZE = 1;
        this.define(Class.genericEntity);
        this.maxSpeed = 0;
        this.facing = 0;
        this.vfacing = 0;
        this.range = 0;
        this.damageReceived = 0;
        this.stepRemaining = 1;
        this.x = position.x;
        this.y = position.y;
        this.cx = position.x;
        this.cy = position.y;
        this.velocity = new Vector(0, 0);
        this.accel = new Vector(0, 0);
        this.damp = .05;
        this.collisionArray = [];
        this.invuln = false;
        this.godmode = false;
        this.passive = false;
        this.alpha = 1;
        this.spinSpeed = .038;
        this.tierCounter = 0;
        this.killedByK = false;
        this.id = entitiesIdLog++;
        this.team = this === master ? this.id : master.team;
        this.rainbow = false;
        this.intervalID = null;
        this.rainbowLoop = this.rainbowLoop.bind(this);
        this.keyFEntity = "square";
        this.updateAABB = () => {};
        this.tank = "basic";
        this.nameColor = "#FFFFFF";
        this.rainbowSpeed = 30;
        this.onDead = null;
        this.canUseQ = true;
        this.multibox = {
            enabled: false,
            intervalID: null,
            controlledTanks: []
        };
        this.multiboxLoop = this.multiboxLoop.bind(this);
        this.getAABB = (() => {
            let data = {},
                savedSize = 0,
                getLongestEdge = (x1, y1, x2, y2) => Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
            this.updateAABB = active => {
                if (this.settings.hitsOwnType !== "shield" && this.bond != null) return 0;
                if (!active) {
                    data.active = false;
                    return 0;
                }
                let x1 = Math.min(this.x, this.x + this.velocity.x + this.accel.x) - this.realSize - 5,
                    y1 = Math.min(this.y, this.y + this.velocity.y + this.accel.y) - this.realSize - 5,
                    x2 = Math.max(this.x, this.x + this.velocity.x + this.accel.x) + this.realSize + 5,
                    y2 = Math.max(this.y, this.y + this.velocity.y + this.accel.y) + this.realSize + 5,
                    size = getLongestEdge(x1, y1, x2, y1),
                    sizeDiff = savedSize / size;
                data = {
                    min: [x1, y1],
                    max: [x2, y2],
                    active: true,
                    size: size
                };
                if (sizeDiff > Math.SQRT2 || sizeDiff < Math.SQRT1_2) {
                    this.removeFromGrid();
                    this.addToGrid();
                    savedSize = data.size;
                }
            };
            return () => data;
        })();
        this.updateAABB(true);
        this.iceStatic = {
            enabled: false,
            mult: 1,
            duration: 0
        };
        this.ice = {
            time: 0,
            active: false,
            mult: 1,
            remaining: -1
        };
        this.poisonStatic = {
            enabled: false,
            mult: 1,
            duration: 0
        };
        this.poison = {
            active: false,
            mult: 1,
            time: 0,
            remaining: -1
        };
        this.vaccineStatic = {
            enabled: false,
            mult: 1,
            duration: 0
        };
        this.vaccine = {
            active: false,
            mult: 1,
            time: 0,
            remaining: -1
        };
        this.empStatic = {
            enabled: false,
            duration: 0
        };
        this.emp = {
            active: false,
            time: 0,
            remaining: -1,
            master: null
        };
        this.crit = {
            enabled: false,
            mult: 0,
            chance: 0
        };
        this.immuneToAbilities = false;
        this.sanctuaryType = "None";
        this.isMothership = false;
        this.isDominator = false;
        this.isBot = false;
        this.underControl = false;
        this.stealthMode = false;
        this.miscIdentifier = "None";
        this.switcherooID = -1;
        entities.push(this);
        for (let v of views) v.add(this);
    }
    removeFromGrid() {
        if (this.isInGrid) {
            grid.removeObject(this);
            this.isInGrid = false;
        }
    }
    addToGrid() {
        if (!this.isInGrid && (this.settings.hitsOwnType === "shield" || this.bond == null)) {
            grid.addObject(this);
            this.isInGrid = true;
        }
    }
    life() {
        bringToLife(this);
    }
    addController(newIO) {
        if (Array.isArray(newIO)) this.controllers = newIO.concat(this.controllers);
        else this.controllers.unshift(newIO);
    }
    define(set) {
        try {
            if (set.PARENT != null)
                for (let i = 0; i < set.PARENT.length; i++) this.define(set.PARENT[i]);
            if (set.index != null) this.index = set.index;
            if (set.NAME != null) this.name = set.NAME;
            if (set.LABEL != null) this.label = set.LABEL;
            if (set.TYPE != null) this.type = set.TYPE;
            if (set.SHAPE != null) this.shape = set.SHAPE;
            if (set.COLOR != null) this.color = set.COLOR;
            if (set.CONTROLLERS != null) {
                let toAdd = [];
                for (let ioName of set.CONTROLLERS) toAdd.push(eval("new io_" + ioName + "(this)"));
                this.addController(toAdd);
            }
            if (set.MOTION_TYPE != null) this.motionType = set.MOTION_TYPE;
            if (set.FACING_TYPE != null) this.facingType = set.FACING_TYPE;
            if (set.DRAW_HEALTH != null) this.settings.drawHealth = set.DRAW_HEALTH;
            if (set.DRAW_SELF != null) this.settings.drawShape = set.DRAW_SELF;
            if (set.DAMAGE_EFFECTS != null) this.settings.damageEffects = set.DAMAGE_EFFECTS;
            if (set.RATIO_EFFECTS != null) this.settings.ratioEffects = set.RATIO_EFFECTS;
            if (set.MOTION_EFFECTS != null) this.settings.motionEffects = set.MOTION_EFFECTS;
            if (set.GIVE_KILL_MESSAGE != null) this.settings.givesKillMessage = set.GIVE_KILL_MESSAGE;
            if (set.CAN_GO_OUTSIDE_ROOM != null) this.settings.canGoOutsideRoom = set.CAN_GO_OUTSIDE_ROOM;
            if (set.HITS_OWN_TYPE != null) this.settings.hitsOwnType = set.HITS_OWN_TYPE;
            if (set.DIE_AT_LOW_SPEED != null) this.settings.diesAtLowSpeed = set.DIE_AT_LOW_SPEED;
            if (set.DIE_AT_RANGE != null) this.settings.diesAtRange = set.DIE_AT_RANGE;
            if (set.INDEPENDENT != null) this.settings.independent = set.INDEPENDENT;
            if (set.PERSISTS_AFTER_DEATH != null) this.settings.persistsAfterDeath = set.PERSISTS_AFTER_DEATH;
            if (set.CLEAR_ON_MASTER_UPGRADE != null) this.settings.clearOnMasterUpgrade = set.CLEAR_ON_MASTER_UPGRADE;
            if (set.HEALTH_WITH_LEVEL != null) this.settings.healthWithLevel = set.HEALTH_WITH_LEVEL;
            if (set.ACCEPTS_SCORE != null) this.settings.acceptsScore = set.ACCEPTS_SCORE;
            if (set.NECRO != null) this.settings.isNecromancer = set.NECRO;
            if (set.HAS_NO_RECOIL != null) this.settings.hasNoRecoil = set.HAS_NO_RECOIL;
            if (set.CRAVES_ATTENTION != null) this.settings.attentionCraver = set.CRAVES_ATTENTION;
            if (set.BROADCAST_MESSAGE != null) this.settings.broadcastMessage = set.BROADCAST_MESSAGE || undefined;
            if (set.DAMAGE_CLASS != null) this.settings.damageClass = set.DAMAGE_CLASS;
            if (set.BUFF_VS_FOOD != null) this.settings.buffVsFood = set.BUFF_VS_FOOD;
            if (set.CAN_BE_ON_LEADERBOARD != null) this.settings.leaderboardable = set.CAN_BE_ON_LEADERBOARD;
            if (set.IS_SMASHER != null) this.settings.reloadToAcceleration = set.IS_SMASHER;
            if (set.DIES_BY_OBSTACLES != null) this.settings.diesByObstacles = set.DIES_BY_OBSTACLES;
            if (set.IS_HELICOPTER != null) this.settings.isHelicopter = set.IS_HELICOPTER;
            if (set.GO_THRU_OBSTACLES != null) this.settings.goThruObstacle = set.GO_THRU_OBSTACLES;
            if (set.STAT_NAMES != null) this.settings.skillNames = set.STAT_NAMES;
            if (set.HAS_ANIMATION != null) this.settings.hasAnimation = set.HAS_ANIMATION;
            if (set.INTANGIBLE != null) this.intangibility = set.INTANGIBLE;
            if (set.AI != null) this.aiSettings = set.AI;
            if (set.DANGER != null) this.dangerValue = set.DANGER;
            if (set.VARIES_IN_SIZE != null) {
                this.settings.variesInSize = set.VARIES_IN_SIZE;
                this.squiggle = this.settings.variesInSize ? ran.randomRange(.8, 1.2) : 1;
            }
            if (set.RESET_UPGRADES) this.upgrades = [];
            if (set.DIES_TO_TEAM_BASE != null) this.diesToTeamBase = set.DIES_TO_TEAM_BASE;
            if (set.GOD_MODE != null) this.godmode = set.GOD_MODE;
            if (set.HAS_NO_SKILL_POINTS != null && set.HAS_NO_SKILL_POINTS) this.skill.points = 0;
            if (set.HAS_ALL_SKILL_POINTS != null && set.HAS_ALL_SKILL_POINTS) this.skill.points = 42;
            if (set.LAYER != null) this.LAYER = set.LAYER;
            if (set.ALPHA != null) this.alpha = set.ALPHA;
            if (set.TEAM != null && set.TEAM !== -1) this.team = set.TEAM;
            if (set.BOSS_TIER_TYPE != null) this.bossTierType = set.BOSS_TIER_TYPE;
            if (set.SYNC_TURRET_SKILLS != null) this.syncTurretSkills = set.SYNC_TURRET_SKILLS;
            if (set.INVISIBLE != null && set.INVISIBLE !== []) {
                if (set.INVISIBLE.length !== 3) throw ("Invalid invisibility values!");
                this.invisible = set.INVISIBLE;
            }
            if (set.SEE_INVISIBLE != null) this.seeInvisible = set.SEE_INVISIBLE;
            if (set.BOSS_TYPE != null && set.BOSS_TYPE !== "None") switch (set.BOSS_TYPE) {
                case "Constellation":
                    this.onDead = () => {
                        sockets.broadcast("A Constellation boss may have been defeated, but the battle is not won yet...");
                        let x = this.x,
                            y = this.y;
                        setTimeout(() => {
                            sockets.broadcast("Constellation Shards have spawned to avenge the Constellation!");
                            let positions = [
                                    [x + 110, y, -110, 0],
                                    [x - 110, y, 110, 0],
                                    [x, y + 110, 0, -110],
                                    [x, y - 110, 0, 110]
                                ],
                                names = ran.chooseBossName("a", 5);
                            for (let i = 0; i < 4; i++) {
                                let shard = new Entity({
                                    x: positions[i][0],
                                    y: positions[i][1]
                                });
                                shard.team = -100;
                                shard.control.target.x = positions[i][2];
                                shard.control.target.y = positions[i][3];
                                shard.define(Class.constShard);
                                shard.name = names[i];
                                shard.settings.broadcastMessage = "A Constellation Shard has been defeated!";
                            }
                            let core = new Entity({
                                x: x,
                                y: y
                            });
                            core.team = -100;
                            core.control.target.x = core.control.target.y = 100;
                            core.define(Class.constCore);
                            core.name = names[4];
                            core.settings.broadcastMessage = "A Constellation Core has been defeated!";
                        }, 7500);
                    };
                    break;
                case "Bow":
                    this.onDead = () => {
                        sockets.broadcast("A Bow may have been defeated, but the battle is not over yet...");
                        let x = this.x,
                            y = this.y;
                        setTimeout(() => {
                            sockets.broadcast("Bow Shards have spawned to avenge the Bow!");
                            let positions = [
                                    [x + 100, y, 100, 0],
                                    [x - 100, y, -100, 0]
                                ],
                                names = ran.chooseBossName("a", 3);
                            for (let i = 0; i < 2; i++) {
                                let shard = new Entity({
                                    x: positions[i][0],
                                    y: positions[i][1]
                                });
                                shard.team = -100;
                                shard.control.target.x = positions[i][2];
                                shard.control.target.y = positions[i][3];
                                shard.define(Class.bowShard);
                                shard.name = names[i];
                                shard.settings.broadcastMessage = "A Bow Shard has been defeated!";
                            }
                            let core = new Entity({
                                x: x,
                                y: y
                            });
                            core.team = -100;
                            core.control.target.x = core.control.target.y = 100;
                            core.define(Class.bowCore);
                            core.name = names[2];
                            core.settings.broadcastMessage = "A Bow Core has been defeated!";
                        }, 5000);
                    };
                    break;
                case "Snowflake":
                    this.onDead = () => {
                        sockets.broadcast("A Snowflake may have been defeated, but the battle is not over yet...");
                        let x = this.x,
                            y = this.y;
                        setTimeout(() => {
                            sockets.broadcast("Snowflake Shards have spawned to avenge the Snowflake!");
                            let positions = [
                                    [x, y + 100, 0, 100],
                                    [x + 86.602, y + 50, 86.602, 50],
                                    [x + 86.602, y - 50, 86.602, -50],
                                    [x, y - 100, 0, -100],
                                    [x - 86.602, y - 50, -86.602, -50],
                                    [x - 86.602, y + 50, -86.602, 50]
                                ],
                                names = ran.chooseBossName("a", 7);
                            for (let i = 0; i < 6; i++) {
                                let shard = new Entity({
                                    x: positions[i][0],
                                    y: positions[i][1]
                                });
                                shard.team = -100;
                                shard.control.target.x = positions[i][2];
                                shard.control.target.y = positions[i][3];
                                shard.define(Class.snowflakeShard);
                                shard.name = names[i];
                                shard.settings.broadcastMessage = "A Snowflake Shard has been defeated!";
                            }
                            let core = new Entity({
                                x: x,
                                y: y
                            });
                            core.team = -100;
                            core.control.target.x = core.control.target.y = 100;
                            core.define(Class.snowflakeCore);
                            core.settings.broadcastMessage = "A Snowflake Core has been defeated!";
                            core.name = names[2];
                        }, 7500);
                    };
                    break;
                case "XYV":
                    this.onDead = () => {
                        sockets.broadcast("Xyv Wdtcfgzsezgk might have been defeated, but the battle is not over yet...");
                        let x = this.x,
                            y = this.y;
                        setTimeout(() => {
                            sockets.broadcast("A Summoner, Guardian, and Defender have spawned to avenge the Xyv Wdtcfgzsezgk!");
                            let positions = [
                                    [x, y + 100, 0, 100],
                                    [x + 86.602, y - 50, 86.602, -50],
                                    [x - 86.602, y - 50, -86.602, -50]
                                ],
                                names = ran.chooseBossName("a", 3);
                            for (let i = 0; i < 3; i++) {
                                let boss = new Entity({
                                    x: positions[i][0],
                                    y: positions[i][1]
                                });
                                boss.team = -100;
                                boss.define([Class.guardianAI, Class.summonerAI, Class.defenderAI][i]);
                                boss.name = names[i];
                            }
                        }, 7500);
                    };
                    break;
                case "crush":
                    this.onDead = () => {
                        let x = this.x,
                            y = this.y;;
                        for (let i = 0; i < 3; i++) {
                            let crash = new Entity({
                                x: x,
                                y: y
                            });
                            crash.team = -100;
                            crash.define(Class.crusherShards);
                        }
                    };
                    break;
                case "iceCrush":
                    this.onDead = () => {
                        let x = this.x,
                            y = this.y;
                        for (let i = 0; i < 3; i++) {
                            let crash = new Entity({
                                x: x,
                                y: y
                            });
                            crash.team = -100;
                            crash.define(Class.iceCrusherShards);
                        }
                    };
                    break;
                case "boomCrusher":
                    this.onDead = () => {
                        let x = this.x,
                            y = this.y;
                        for (let i = 0; i < 10; i++) {
                            let crash = new Entity({
                                x: x,
                                y: y
                            });
                            crash.team = -100;
                            crash.define(Class.boomCrusherShards);
                        }
                    };
                    break;
                case "redRunner1":
                    setTimeout(() => {
                        if (this.isAlive()) {
                            this.SIZE *= 2;
                            this.define(Class.redRunner2);
                        }
                    }, 15000);
                    break;
                case "redRunner2":
                    setTimeout(() => {
                        if (this.isAlive()) {
                            this.SIZE *= 3;
                            this.define(Class.redRunner3);
                        }
                    }, 3e4);
                    break;
                case "redRunner3":
                    setTimeout(() => {
                        if (this.isAlive()) {
                            this.SIZE *= 4;
                            this.define(Class.redRunner4);
                        }
                    }, 6e4);
                    break;
                case "splitHexagon":
                    this.onDead = () => {
                        let x = this.x,
                            y = this.y;
                        for (let i = 0; i < 2; i++) {
                            let crash = new Entity({
                                x: x,
                                y: y
                            });
                            crash.team = -100;
                            crash.define(Class.trapezoidCrasher);
                        }
                    };
                    setTimeout(() => {
                        if (this.isAlive()) {
                            this.define(Class.splitterDecagon);
                            this.SIZE *= 1.2;
                        }
                    }, 72e4);
                    break;
                case "splitPentagon":
                    this.onDead = () => {
                        let x = this.x,
                            y = this.y;
                        for (let i = 0; i < 5; i++) {
                            let crash = new Entity({
                                x: x,
                                y: y
                            });
                            crash.team = -100;
                            crash.define(Class.crasher);
                        }
                    };
                    setTimeout(() => {
                        if (this.isAlive()) {
                            this.define(Class.splitterHexagon);
                            this.SIZE *= 1.2;
                        }
                    }, 48e4);
                    break;
                case "splitSquare":
                case "splitSquare2":
                    this.onDead = () => {
                        let x = this.x,
                            y = this.y;
                        for (let i = 0; i < 4; i++) {
                            let crash = new Entity({
                                x: x,
                                y: y
                            });
                            crash.team = -100;
                            crash.define(Class.summonerSquare);
                        }
                    };
                    if (set.BOSS_TYPE !== "splitSquare2") setTimeout(() => {
                        if (this.isAlive()) {
                            let rand = Math.floor(Math.random() * 2),
                                randPoly = !rand ? "splitterPentagon" : "splitterSplitterSquare";
                            this.define(Class[randPoly]);
                            this.SIZE *= 1.75;
                        }
                    }, 24e4);
                    break;
                case "splitSplitSquare":
                    this.onDead = () => {
                        let x = this.x,
                            y = this.y,
                            positions = [
                                {x: x - 10, y: y - 10},
                                {x: x - 10, y: y + 10},
                                {x: x + 10, y: y + 10},
                                {x: x + 10, y: y - 10}
                            ];
                        for (let i = 0; i < 4; i++) {
                            let shape = new Entity(positions[i]);
                            shape.team = -100;
                            shape.define(Class.splitterSquare2);
                            shape.ACCELERATION = .015 / shape.foodLevel;
                        }
                    };
                    break;
                case "summonerSquare":
                    this.onDead = () => {
                        let x = this.x,
                            y = this.y,
                            crash = new Entity({
                                x: x,
                                y: y
                            });
                        crash.team = -100;
                        crash.define(Class.summonerSquare);
                    };
                    this.kill();
                    break;
                case "triRunner":
                    this.onDead = () => {
                        let x = this.x,
                            y = this.y,
                            crash = new Entity({
                                x: x,
                                y: y
                            });
                        crash.team = -100;
                        crash.define(Class.redRunner2);
                    };
                    this.kill();
                    break;
                case "triBlade":
                    this.onDead = () => {
                        let x = this.x,
                            y = this.y,
                            crash = new Entity({
                                x: x,
                                y: y
                            });
                        crash.team = -100;
                        crash.define(Class.bladeCrasher);
                    };
                    this.kill();
                    break;
                case "groupers":
                    this.onDead = () => {
                        let x = this.x,
                            y = this.y;
                        for (let i = 0; i < 4; i++) {
                            let crash = new Entity({
                                x: x,
                                y: y
                            });
                            crash.team = -100;
                            crash.define(Class.grouperCrasher);
                        }
                    };
                    this.kill();
                    break;
                case "defender":
                    this.onDead = () => {
                        let x = this.x,
                            y = this.y,
                            rand = Math.floor(Math.random() * 6 + 1) + 2;
                        for (let i = 0; i < rand; i++) {
                            let crash = new Entity({
                                x: x,
                                y: y
                            })
                            crash.team = -100;
                            crash.define(Class.bladeCrasher);
                        }
                    };
                    break;
                case "squareNest":
                    this.onDead = () => {
                        let x = this.x,
                            y = this.y;
                        for (let i = 0; i < 12; i++) {
                            let crash = new Entity({
                                x: x + 200 * Math.cos(i * Math.PI / 6),
                                y: y + 200 * Math.sin(i * Math.PI / 6)
                            });
                            crash.team = -100;
                            crash.control.target.x = 200 * Math.cos(i * Math.PI / 6);
                            crash.control.target.y = 200 * Math.sin(i * Math.PI / 6);
                            crash.define(Class.summonerSquare);
                        }
                        for (let i = 0; i < 4; i++) {
                            let shape = new Entity({
                                x: x + 250 * Math.cos(i * Math.PI / 2 + Math.PI / 4),
                                y: y + 250 * Math.sin(i * Math.PI / 2 + Math.PI / 4)
                            });
                            shape.team = -100;
                            shape.control.target.x = 250 * Math.cos(i * Math.PI / 2 + Math.PI / 4);
                            shape.control.target.y = 250 * Math.sin(i * Math.PI / 2 + Math.PI / 4);
                            shape.define(Class.greenSquare);
                            shape.ACCELERATION = .015 / shape.foodLevel;
                        }
                        for (let i = 0; i < 4; i++) {
                            let shape = new Entity({
                                x: x + 350 * Math.cos(i * Math.PI / 2),
                                y: y + 350 * Math.sin(i * Math.PI / 2)
                            });
                            shape.team = -100;
                            shape.control.target.x = 350 * Math.cos(i * Math.PI / 2);
                            shape.control.target.y = 350 * Math.sin(i * Math.PI / 2);
                            shape.define(Class.splitterSquare);
                            shape.ACCELERATION = .015 / shape.foodLevel;
                        }
                        for (let i = 0; i < 20; i++) {
                            let shape = new Entity({
                                x: x + 400 * Math.cos(i * Math.PI / 10),
                                y: y + 400 * Math.sin(i * Math.PI / 10)
                            });
                            shape.team = -100;
                            shape.control.target.x = 400 * Math.cos(i * Math.PI / 10);
                            shape.control.target.y = 400 * Math.sin(i * Math.PI / 10);
                            shape.define(Class.singularSquare);
                            shape.ACCELERATION = .015 / shape.foodLevel;
                        }
                        for (let i = 0; i < 2; i++) {
                            let sentry = new Entity({
                                x: x + 275 * Math.cos(i * Math.PI),
                                y: y + 275 * Math.sin(i * Math.PI)
                            });
                            sentry.team = -100;
                            sentry.control.target.x = 275 * Math.cos(i * Math.PI);
                            sentry.control.target.y = 275 * Math.sin(i * Math.PI);
                            sentry.define(Class.squareGunSentry);
                        }
                    };
                    this.kill();
                    break;
                case "triangleNest":
                    this.onDead = () => {
                        let x = this.x,
                            y = this.y;
                        for (let i = 0; i < 10; i++) {
                            let crash = new Entity({
                                x: x + 200 * Math.cos(i * Math.PI / 5),
                                y: y + 200 * Math.sin(i * Math.PI / 5)
                            });
                            crash.team = -100;
                            crash.control.target.x = 200 * Math.cos(i * Math.PI / 5);
                            crash.control.target.y = 200 * Math.sin(i * Math.PI / 5);
                            crash.define(Class.crasher);
                        }
                        for (let i = 0; i < 4; i++) {
                            let crash = new Entity({
                                x: x + 200 * Math.cos(i * Math.PI / 2),
                                y: y + 200 * Math.sin(i * Math.PI / 2)
                            });
                            crash.team = -100;
                            crash.control.target.x = 200 * Math.cos(i * Math.PI / 2);
                            crash.control.target.y = 200 * Math.sin(i * Math.PI / 2);
                            crash.define(Class.redRunner1);
                        }
                        for (let i = 0; i < 4; i++) {
                            let shape = new Entity({
                                x: x + 250 * Math.cos(i * Math.PI / 2),
                                y: y + 250 * Math.sin(i * Math.PI / 2)
                            });
                            shape.team = -100;
                            shape.control.target.x = 250 * Math.cos(i * Math.PI / 2);
                            shape.control.target.y = 250 * Math.sin(i * Math.PI / 2);
                            shape.define(Class.greenTriangle);
                            shape.ACCELERATION = .015 / shape.foodLevel;
                        }
                        for (let i = 0; i < 8; i++) {
                            let crash = new Entity({
                                x: x + 350 * Math.cos(i * Math.PI / 4),
                                y: y + 350 * Math.sin(i * Math.PI / 4)
                            });
                            crash.team = -100;
                            crash.control.target.x = 350 * Math.cos(i * Math.PI / 4);
                            crash.control.target.y = 350 * Math.sin(i * Math.PI / 4);
                            crash.define(Class.bladeCrasher);
                        }
                        for (let i = 0; i < 20; i++) {
                            let shape = new Entity({
                                x: x + 400 * Math.cos(i * Math.PI / 10),
                                y: y + 400 * Math.sin(i * Math.PI / 10)
                            });
                            shape.team = -100;
                            shape.control.target.x = 400 * Math.cos(i * Math.PI / 10);
                            shape.control.target.y = 400 * Math.sin(i * Math.PI / 10);
                            shape.define(Class.singularTriangle);
                            shape.ACCELERATION = .015 / shape.foodLevel;
                        }
                        for (let i = 0; i < 2; i++) {
                            let sentry = new Entity({
                                x: x + 275 * Math.cos(i * Math.PI),
                                y: y + 275 * Math.sin(i * Math.PI)
                            });
                            sentry.team = -100;
                            sentry.control.target.x = 275 * Math.cos(i * Math.PI);
                            sentry.control.target.y = 275 * Math.sin(i * Math.PI);
                            sentry.define(Class.sentryGunAI);
                        }
                    };
                    this.kill();
                    break;
                case "pentagonNest":
                    this.onDead = () => {
                        let x = this.x,
                            y = this.y;
                        for (let i = 0; i < 10; i++) {
                            let crash = new Entity({
                                x: x + 200 * Math.cos(i * Math.PI / 5),
                                y: y + 200 * Math.sin(i * Math.PI / 5)
                            });
                            crash.team = -100;
                            crash.control.target.x = 200 * Math.cos(i * Math.PI / 5);
                            crash.control.target.y = 200 * Math.sin(i * Math.PI / 5);
                            crash.define(Class.semiCrushCrasher);
                        }
                        for (let i = 0; i < 5; i++) {
                            let shape = new Entity({
                                x: x + 200 * Math.cos(i * Math.PI / 2.5),
                                y: y + 200 * Math.sin(i * Math.PI / 2.5)
                            });
                            shape.team = -100;
                            shape.control.target.x = 200 * Math.cos(i * Math.PI / 2.5);
                            shape.control.target.y = 200 * Math.sin(i * Math.PI / 2.5);
                            shape.define(Class.splitterPentagon);
                            shape.ACCELERATION = .015 / shape.foodLevel;
                        }
                        for (let i = 0; i < 4; i++) {
                            let shape = new Entity({
                                x: x + 250 * Math.cos(i * Math.PI / 2),
                                y: y + 250 * Math.sin(i * Math.PI / 2)
                            });
                            shape.team = -100;
                            shape.control.target.x = 250 * Math.cos(i * Math.PI / 2);
                            shape.control.target.y = 250 * Math.sin(i * Math.PI / 2);
                            shape.define(Class.greenPentagon);
                            shape.ACCELERATION = .015 / shape.foodLevel;
                        }
                        for (let i = 0; i < 8; i++) {
                            let crash = new Entity({
                                x: x + 350 * Math.cos(i * Math.PI / 4),
                                y: y + 350 * Math.sin(i * Math.PI / 4)
                            });
                            crash.team = -100;
                            crash.control.target.x = 350 * Math.cos(i * Math.PI / 4);
                            crash.control.target.y = 350 * Math.sin(i * Math.PI / 4);
                            crash.define(Class.crushCrasher);
                        }
                        for (let i = 0; i < 18; i++) {
                            let shape = new Entity({
                                x: x + 400 * Math.cos(i * Math.PI / 9),
                                y: y + 400 * Math.sin(i * Math.PI / 9)
                            });
                            shape.team = -100;
                            shape.control.target.x = 400 * Math.cos(i * Math.PI / 9);
                            shape.control.target.y = 400 * Math.sin(i * Math.PI / 9);
                            shape.define(Class.singularPentagon);
                            shape.ACCELERATION = .015 / shape.foodLevel;
                        }
                        for (let i = 0; i < 4; i++) {
                            let sentry = new Entity({
                                x: x + 275 * Math.cos(i * Math.PI / 2),
                                y: y + 275 * Math.sin(i * Math.PI / 2)
                            });
                            sentry.team = -100;
                            sentry.control.target.x = 275 * Math.cos(i * Math.PI / 2);
                            sentry.control.target.y = 275 * Math.sin(i * Math.PI / 2);
                            sentry.define(Class.sentryGunAI);
                        }
                    };
                    this.kill();
                    break;
                case "longlong": // splitDecagon
                    this.onDead = () => {
                        let x = this.x,
                            y = this.y,
                            size = this.size / 1.25;
                        for (let i = 0; i < 10; i++) {
                            let crash = new Entity({
                                x: size * Math.cos(i * Math.PI / 5) + x,
                                y: size * Math.sin(i * Math.PI / 5) + y
                            });
                            crash.team = -100;
                            crash.define(Class.longCrasher);
                            crash.facingType = "looseWithMotion";
                            crash.facing += i * Math.PI / 5 + Math.PI;
                        }
                    };
                    break;
                case "destroyer":
                    this.onDead = () => {
                        let x = this.x,
                            y = this.y,
                            crash = new Entity({
                                x: x,
                                y: y
                            });
                        crash.team = -100;
                        crash.define(Class.summonerSquare);
                    };
                    break;
                case "crescent":
                    setTimeout(() => {
                        if (this.isAlive()) this.define(Class.crescent);
                    }, 2000);
                    break;
                case "revo":
                    this.onDead = () => {
                        if (this.master.isAlive()) this.master.define(Class.baseThrower);
                    };
                    break;
                case "mei":
                    setTimeout(() => {
                        if (this.isAlive()) this.define(Class.mei);
                    }, 2000);
                    break;
                case "kashmir":
                    setTimeout(() => {
                        if (this.isAlive()) this.define(Class.kashmir0);
                    }, 2000);
                    break;
                case "oxy":
                    setTimeout(() => {
                        if (this.isAlive()) this.define(Class.guardianLauncher);
                    }, 2000);
                    break;
                case "gold":
                    setTimeout(() => {
                        if (this.isAlive()) {
                            this.define(Class.burntIcosagon);
                            sockets.broadcast("The Golden Nonagon has evolved into a Golden Icosagon!");
                        }
                    }, 12e4);
                    break;
                case "mladic":
                    setTimeout(() => {
                        if (this.isAlive()) {
                            sockets.broadcast("The Golden Icosagon is sending out messages, move away from it!");
                            let x = this.x,
                                y = this.y;
                            setTimeout(() => {
                                sockets.broadcast("Mladic has been summoned!");
                                let boss = new Entity({
                                    x: x + 450,
                                    y: y
                                });
                                boss.team = -100;
                                boss.define(Class.mladicAI);
                                boss.name = 'Mladic';
                            }, 7500);
                        }
                    }, 1000/*12e4*/);
                    break;
                default:
                    util.warn("Invalid boss type: " + set.BOSS_TYPE + "!");
            }
            if (set.SANCTUARY_TYPE != null && set.SANCTUARY_TYPE !== "None") {
                this.sanctuaryType = set.SANCTUARY_TYPE;
                this.miscIdentifier = "appearOnMinimap";
                /*const smoke = (timeout, x, y) => {
                    let smokeSpawner = new Entity({
                        x: x,
                        y: y
                    });
                    smokeSpawner.define(Class.smokeSpawner);
                    smokeSpawner.passive = true;
                    setTimeout(() => smokeSpawner.kill(), timeout);
                };*/
                switch (set.SANCTUARY_TYPE) {
                    case "Egg":
                        this.onDead = () => {
                            sockets.broadcast("The Egg Sanctuary seems to have left something in its demise...");
                            let x = this.x,
                                y = this.y;
                            //smoke(6000, x, y);
                            setTimeout(() => {
                                let boss = new Entity({
                                    x: this.x,
                                    y: this.y
                                });
                                sockets.broadcast("An EK-1 has spawned to avenge the Egg Sanctuary!");
                                boss.team = -100;
                                boss.control.target.x = boss.control.target.y = 100;
                                boss.define(Class.eggBossTier1AI);
                                boss.name = ran.chooseBossName("a", 1)[0];
                                boss.miscIdentifier = "Sanctuary Boss";
                                setTimeout(() => {
                                    if (boss.isAlive()) {
                                        sockets.broadcast("The EK-1's wrath has remained unhindered for too long; it appears to be evolving...");
                                        setTimeout(() => {
                                            if (boss.isAlive()) {
                                                for (let i = 1; i < 102; i++) setTimeout(() => {
                                                    if (boss.isAlive()) {
                                                        boss.define(Class[`ekAnim${i}`]);
                                                        if (i === 101) boss.define(Class.eggBossTier2AI);
                                                    }
                                                }, 36 * i);
                                                boss.miscIdentifier = "Sanctuary Boss";
                                                sockets.broadcast("The EK-1 has evolved into an EK-2!");
                                            } else sockets.broadcast("The EK-1 has been consoled just in time...");
                                        }, 6000);
                                    }
                                }, 6e5);
                            }, 6000);
                        };
                        break;
                    case "Square":
                        this.onDead = () => {
                            sockets.broadcast("The Square Sanctuary seems to have left something in its demise...");
                            let x = this.x,
                                y = this.y;
                            setTimeout(() => {
                                sockets.broadcast("A Summoner has spawned to avenge the Square Sanctuary!");
                                let boss = new Entity({
                                    x: x,
                                    y: y
                                });
                                boss.team = -100;
                                boss.control.target.x = boss.control.target.y = 100;
                                boss.define(Class.summonerAI);
                                boss.name = ran.chooseBossName("a", 1)[0];
                                boss.miscIdentifier = "Sanctuary Boss";
                            }, 6000);
                        };
                        break;
                    case "Triangle":
                        this.onDead = () => {
                            sockets.broadcast("The Triangle Sanctuary seems to have left something in its demise...");
                            let x = this.x,
                                y = this.y;
                            setTimeout(() => {
                                sockets.broadcast("A Defender has spawned to avenge the Triangle Sanctuary!");
                                let boss = new Entity({
                                    x: x,
                                    y: y
                                });
                                boss.team = -100;
                                boss.control.target.x = boss.control.target.y = 100;
                                boss.define(Class.defenderAI);
                                boss.name = ran.chooseBossName("a", 1)[0];
                                boss.miscIdentifier = "Sanctuary Boss";
                            }, 6000);
                        };
                        break;
                    case "Pentagon":
                        this.onDead = () => {
                            sockets.broadcast("The Pentagon Sanctuary seems to have left something in its demise...");
                            let x = this.x,
                                y = this.y;
                            setTimeout(() => {
                                sockets.broadcast("A Leviathan has spawned to avenge the Pentagon Sanctuary!");
                                let boss = new Entity({
                                    x: x,
                                    y: y
                                });
                                boss.team = -100;
                                boss.control.target.x = boss.control.target.y = 100;
                                boss.define(Class.leviathanAI);
                                boss.name = ran.chooseBossName("a", 1)[0];
                                boss.miscIdentifier = "Sanctuary Boss";
                            }, 6000);
                        };
                        break;
                    case "Burnt":
                        this.onDead = () => {
                            sockets.broadcast("The Golden Sanctuary seems to have left something in its demise...");
                            let x = this.x,
                                y = this.y;
                            setTimeout(() => {
                                sockets.broadcast("A Golden Nonagon has spawned!");
                                let poly = new Entity({
                                    x: this.x,
                                    y: this.y
                                });
                                poly.team = -100;
                                poly.define(Class.burntNonagon);
                                poly.ACCELERATION = .015 / poly.foodLevel;
                                poly.miscIdentifier = "Sanctuary Boss";
                            }, 6000);
                        };
                        break;
                    case "Bow":
                        this.onDead = () => {
                            sockets.broadcast("The Bowed Sanctuary seems to have left something in its demise...");
                            let x = this.x,
                                y = this.y;
                            setTimeout(() => {
                                sockets.broadcast("A Bow has spawned to avenge the Bowed Sanctuary!");
                                let boss = new Entity({
                                    x: x,
                                    y: y
                                });
                                boss.team = -100;
                                boss.control.target.x = boss.control.target.y = 100;
                                boss.define(Class.bowAI);
                                boss.name = ran.chooseBossName("a", 1)[0];
                                boss.miscIdentifier = "Sanctuary Boss";
                            }, 6000);
                        };
                        break;
                    default:
                        util.warn("Invalid sanctuary type: " + this.sanctuaryType + "!");
                        this.miscIdentifier = this.sanctuaryType = "None";
                }
            }
            if (set.UPGRADES_TIER_1 != null)
                for (let e of set.UPGRADES_TIER_1) this.upgrades.push({
                    class: tankList[e.index + room.manualOffset],
                    level: 15,
                    index: e.index,
                    tier: 1
                });
            if (set.UPGRADES_TIER_2 != null)
                for (let e of set.UPGRADES_TIER_2) this.upgrades.push({
                    class: tankList[e.index + room.manualOffset],
                    level: 30,
                    index: e.index,
                    tier: 2
                });
            if (set.UPGRADES_TIER_3 != null)
                for (let e of set.UPGRADES_TIER_3) this.upgrades.push({
                    class: tankList[e.index + room.manualOffset],
                    level: 45,
                    index: e.index,
                    tier: 3
                });
            if (set.UPGRADES_TIER_4 != null)
                for (let e of set.UPGRADES_TIER_4) this.upgrades.push({
                    class: tankList[e.index + room.manualOffset],
                    level: 60,
                    index: e.index,
                    tier: 4
                });
            if (set.SIZE != null) {
                this.SIZE = set.SIZE * this.squiggle;
                if (this.coreSize == null) this.coreSize = this.SIZE;
            }
            if (set.SKILL != null && set.SKILL !== []) {
                if (set.SKILL.length !== 10) throw ("Invalid skill raws!");
                this.skill.set(set.SKILL);
            }
            if (set.LEVEL != null) {
                if (set.LEVEL === -1) this.skill.reset();
                while (this.skill.level < c.SKILL_CHEAT_CAP && this.skill.level < set.LEVEL) {
                    this.skill.score += this.skill.levelScore;
                    this.skill.maintain();
                }
                this.refreshBodyAttributes();
            }
            if (set.SKILL_CAP != null && set.SKILL_CAP !== []) {
                if (set.SKILL_CAP.length !== 10) throw ("Invalid skill caps!");
                this.skill.setCaps(set.SKILL_CAP);
            }
            if (set.VALUE != null) this.skill.score = Math.max(this.skill.score, set.VALUE * this.squiggle);
            if (set.CAMERA_TO_MOUSE != null && set.CAMERA_TO_MOUSE !== []) {
                if (set.CAMERA_TO_MOUSE.length !== 2) throw ("Invalid camera-to-mouse values!");
                this.cameraToMouse = set.CAMERA_TO_MOUSE;
            }
            if (set.GUNS != null) {
                let newGuns = [];
                for (let def of set.GUNS) newGuns.push(new Gun(this, def));
                this.guns = newGuns;
            }
            if (set.MAX_CHILDREN != null) this.maxChildren = set.MAX_CHILDREN;
            if (set.FOOD != null && set.FOOD.LEVEL != null) {
                this.foodLevel = set.FOOD.LEVEL;
                this.foodCountup = 0;
            }
            if (set.BODY != null) {
                if (set.BODY.ACCELERATION != null) this.ACCELERATION = set.BODY.ACCELERATION;
                if (set.BODY.SPEED != null) this.SPEED = set.BODY.SPEED;
                if (set.BODY.HEALTH != null) this.HEALTH = set.BODY.HEALTH;
                if (set.BODY.RESIST != null) this.RESIST = set.BODY.RESIST;
                if (set.BODY.SHIELD != null) this.SHIELD = set.BODY.SHIELD;
                if (set.BODY.REGEN != null) this.REGEN = set.BODY.REGEN;
                if (set.BODY.DAMAGE != null) this.DAMAGE = set.BODY.DAMAGE;
                if (set.BODY.PENETRATION != null) this.PENETRATION = set.BODY.PENETRATION;
                if (set.BODY.FOV != null) this.FOV = set.BODY.FOV;
                if (set.BODY.RANGE != null) this.RANGE = set.BODY.RANGE;
                if (set.BODY.SHOCK_ABSORB != null) this.SHOCK_ABSORB = set.BODY.SHOCK_ABSORB;
                if (set.BODY.DENSITY != null) this.DENSITY = set.BODY.DENSITY;
                if (set.BODY.STEALTH != null) this.STEALTH = set.BODY.STEALTH;
                if (set.BODY.PUSHABILITY != null) this.PUSHABILITY = set.BODY.PUSHABILITY;
                if (set.BODY.HETERO != null) this.heteroMultiplier = set.BODY.HETERO;
                this.refreshBodyAttributes();
            }
            if (set.TURRETS != null) {
                for (let o of this.turrets) o.destroy();
                this.turrets = [];
                for (let def of set.TURRETS) {
                    let o = new Entity(this, this.master);
                    if (Array.isArray(def.TYPE)) {
                        for (let type of def.TYPE) o.define(type);
                    } else o.define(def.TYPE);
                    o.bindToMaster(def.POSITION, this);
                }
            }
            if (set.ICE != null && set.ICE !== []) {
                if (set.ICE.length !== 3) throw ("Invalid ice values!");
                this.iceStatic = {
                    enabled: set.ICE[0],
                    mult: set.ICE[1],
                    duration: set.ICE[2]
                };
            }
            if (set.POISON != null && set.POISON !== []) {
                if (set.POISON.length !== 3) throw ("Invalid poison values!");
                this.poisonStatic = {
                    enabled: set.POISON[0],
                    mult: set.POISON[1],
                    duration: set.POISON[2]
                };
            }
            if (set.VACCINE != null && set.VACCINE !== []) {
                if (set.VACCINE.length !== 3) throw ("Invalid vaccine values!");
                this.vaccineStatic = {
                    enabled: set.VACCINE[0],
                    mult: set.VACCINE[1],
                    duration: set.VACCINE[2]
                };
            }
            if (set.EMP != null && set.EMP !== []) {
                if (set.EMP.length !== 2) throw ("Invalid EMP values!");
                this.empStatic = {
                    enabled: set.EMP[0],
                    duration: set.EMP[1]
                };
            }
            if (set.DIES_INSTANTLY != null) this.kill();
            if (set.CRITICAL != null && set.CRITICAL !== []) {
                if (set.CRITICAL.length !== 3) throw ("Invalid critical damage values!");
                this.crit = {
                    enabled: set.CRITICAL[0],
                    mult: set.CRITICAL[1],
                    duration: set.CRITICAL[2]
                };
            }
            if (set.RANDOM_TYPE != null && set.RANDOM_TYPE !== "None") {
                let choices = [];
                switch (set.RANDOM_TYPE) {
                    case "Rummy":
                        choices = [
                            Class.bullet,
                            Class.trap,
                            Class.block,
                            Class.boomerang,
                            Class.autoSwarm,
                            Class.foamBullet,
                            Class.explosion,
                            Class.velocipedeBullet4,
                            Class.basicAutoBullet2,
                            Class.heatMissile2,
                            Class.littleMissile,
                            Class.bullet,
                            Class.trap,
                            Class.block,
                            Class.boomerang,
                            Class.autoSwarm,
                            Class.foamBullet,
                            Class.explosion,
                            Class.velocipedeBullet4,
                            Class.basicAutoBullet2,
                            Class.heatMissile2,
                            Class.littleMissile,
                            Class.rummyVolley,
                            Class.explosiveNokia
                        ];
                        break;
                    case "Pneuma":
                        choices = [
                            Class.nuke,
                            Class.deroNukeShoe,
                            Class.pneumaTrap,
                            Class.pneumaSwarm,
                            Class.pneumaArc
                        ];
                        break;
                    case "Rectangmancer":
                        choices = [
                            Class.foamBullet,
                            Class.sunchip
                        ];
                        break;
                    case "Workshop":
                        choices = [
                            Class.pillbox,
                            Class.fogblock,
                            Class.splitBlock,
                            Class.boomerang,
                            Class.blockMine,
                            Class.oldBlock,
                            Class.minishipBlock
                        ];
                        break;
                    default:
                        util.warn("Invalid RANDOM_TYPE value: " + set.RANDOM_TYPE + "!");
                }
                this.define(choices[Math.floor(Math.random() * choices.length)]);
            }
            if (set.ABILITY_IMMUNE != null) this.immuneToAbilities = set.ABILITY_IMMUNE;
            if (set.SPAWNS_DECA != null) this.define(Class.decagon);
            if (set.ALWAYS_ACTIVE != null) this.alwaysActive = set.ALWAYS_ACTIVE;
            if (set.MISC_IDENTIFIER != null) this.miscIdentifier = set.MISC_IDENTIFIER;
            if (set.SWITCHEROO_ID != null) this.switcherooID = set.SWITCHEROO_ID;
            if (set.IS_ARENA_CLOSER != null) {
                this.isArenaCloser = set.IS_ARENA_CLOSER;
                if (this.isArenaCloser) this.immuneToAbilities = true;
            }
            if (set.mockup != null) this.mockup = set.mockup;
        } catch (e) {
            if (this.isBot) util.error(this.tank);
            util.error("An error occured while trying to set " + trimName(this.name) + "'s parent entity, aborting! Index: " + this.index + ".");
            this.sendMessage("An error occured while trying to set your parent entity!");
        }
    }
    refreshBodyAttributes() {
        let speedReduce = Math.pow(this.size / (this.coreSize || this.SIZE), 1);
        this.acceleration = c.runSpeed * this.ACCELERATION / speedReduce;
        if (this.settings.reloadToAcceleration) this.acceleration *= this.skill.acl;
        this.topSpeed = c.runSpeed * (this.settings.reloadToAcceleration ? this.SPEED * 1.05 : this.SPEED) * this.skill.mob / speedReduce;
        if (this.settings.reloadToAcceleration) this.topSpeed /= Math.sqrt(this.skill.acl);
        this.health.set(((this.settings.healthWithLevel ? 1.5 /* 1.8 */ * this.skill.level : 0) + this.HEALTH) * (this.settings.reloadToAcceleration ? this.skill.hlt * 1.025 : this.skill.hlt));
        this.health.resist = 1 - 1 / Math.max(1, this.RESIST + this.skill.brst);
        this.shield.set(
            ((this.settings.healthWithLevel ? .6 * this.skill.level : 0) + this.SHIELD) * this.skill.shi,
            Math.max(0, (((this.settings.healthWithLevel ? .006 * this.skill.level : 0) + 1) * this.REGEN) * this.skill.rgn)
        );
        this.damage = this.DAMAGE * (this.settings.reloadToAcceleration ? this.skill.atk * 1.1 /*1.25*/ : this.skill.atk);
        this.penetration = this.PENETRATION + 1.5 * (this.skill.brst + .8 * (this.skill.atk - 1));
        this.range = this.RANGE;
        this.fov = 250 * this.FOV * Math.sqrt(this.size) * (1 + .003 * this.skill.level);
        this.density = (1 + .08 * this.skill.level) * this.DENSITY;
        this.stealth = this.STEALTH;
        this.pushability = this.PUSHABILITY;
    }
    refreshFOV() {
        this.fov = 250 * this.FOV * Math.sqrt(this.size) * (1 + .003 * this.skill.level);
    }
    bindToMaster(position, bond) {
        this.bond = bond;
        this.source = bond;
        this.bond.turrets.push(this);
        this.skill = this.bond.skill;
        this.label = this.bond.label + " " + this.label;
        if (this.settings.hitsOwnType !== "shield") this.removeFromGrid();
        this.settings.drawShape = false;
        this.bound = {};
        this.bound.size = .05 * position[0];
        let offset = new Vector(position[1], position[2]);
        this.bound.angle = position[3] * Math.PI / 180;
        this.bound.direction = offset.direction;
        this.bound.offset = offset.length / 10;
        this.bound.arc = position[4] * Math.PI / 180;
        this.bound.layer = position[5];
        if (this.facingType === "toTarget") {
            this.facing = this.bond.facing + this.bound.angle;
            this.facingType = "bound";
        }
        this.motionType = "bound";
        this.move();
    }
    get size() {
        //if (this.bond == null) return (this.coreSize || this.SIZE) * (1 + this.skill.level / 60);
        if (this.bond == null) return (this.coreSize || this.SIZE) * (1 + (this.skill.level > 45 ? 45 : this.skill.level) / 45);
        return this.bond.size * this.bound.size;
    }
    get mass() {
        return this.density * (this.size * this.size + 1);
    }
    get realSize() {
        return this.size * (Math.abs(this.shape) >= realSizes.length ? 1 : realSizes[Math.abs(this.shape)]);
    }
    get m_x() {
        return (this.velocity.x + this.accel.x) / room.speed;
    }
    get m_y() {
        return (this.velocity.y + this.accel.y) / room.speed;
    }
    camera(tur = false) {
        let out = {
            type: tur * 0x01 + this.settings.drawHealth * 0x02 + (this.type === "tank") * 0x04 + this.invuln * 0x08,
            id: this.id,
            index: this.index,
            x: this.x,
            y: this.y,
            cx: this.x,
            cy: this.y,
            vx: this.velocity.x,
            vy: this.velocity.y,
            size: this.size,
            rsize: this.realSize,
            status: 1,
            health: this.health.display(),
            shield: this.shield.display(),
            facing: this.facing,
            vfacing: this.vfacing,
            twiggle: this.facingType === "looseWithMotion" || this.facingType === "smoothWithMotion" || this.facingType === "spinSlowly" || this.facingType === "spinSlowly2" || this.facingType === "spinSlowly3" ||
                this.facingType === "spinSlowly4" || this.facingType === "altSpin" || this.facingType === "fastSpin" || this.facingType === "autospin" || this.facingType === "autospin2" ||
                this.facingType === "reverseAutospin" || this.facingType === "bitFastSpin" || this.facingType === "hadron" || this.facingType === "locksFacing" &&
                this.control.alt || this.facingType === "hatchet" || this.facingType === "altLocksFacing" || this.facingType === "lmg" && this.control.fire,
            layer: this.passive && this.LAYER !== -1 ? 1 : this.LAYER === -1 ? this.bond == null ? this.type === "wall" ||
                this.type === "mazeWall" ? 11 : this.type === "food" ? 10 : this.type === "tank" ? 5 : this.type === "crasher" ? 1 : 0 : this.bound.layer : this.LAYER,
            color: this.color,
            name: this.name,
            score: this.skill.score,
            guns: this.guns.map(gun => gun.getLastShot()),
            turrets: this.turrets.map(turret => turret.camera(true)),
            alpha: this.alpha,
            seeInvisible: this.seeInvisible,
            nameColor: this.nameColor
        };
        if (this.cameraToMouse[0]) {
            this.cx = out.cx;
            this.cy = out.cy;
            if (!this.control.alt) this.cameraShiftFacing = null;
            else if (this.cameraShiftFacing)[out.cx, out.cy] = this.cameraShiftFacing;
            else {
                out.cx += this.fov * Math.cos(this.facing) / this.cameraToMouse[1]; //= this.control.target.x + this.x;
                out.cy += this.fov * Math.sin(this.facing) / this.cameraToMouse[1]; //= this.control.target.y + this.y;
                this.cameraShiftFacing = [out.cx, out.cy];
            }
        }
        return out;
    }
    skillUp(stat) {
        let upgrade = this.skill.upgrade(stat);
        if (upgrade) {
            this.refreshBodyAttributes();
            for (let gun of this.guns) gun.syncChildren();
        }
        return upgrade;
    }
    upgrade(number) {
        if (number < this.upgrades.length && this.skill.level >= this.upgrades[number].level) {
            let tank = this.upgrades[number].class;
            this.upgrades = [];
            this.define(tank);
            this.tank = tank;
            if (this.switcherooID === 0 || (this.bossTierType !== -1 && this.bossTierType !== 16)) this.sendMessage("Press Q to switch tiers. There is a 1 second cooldown.");
            if (this.cameraToMouse[0]) this.sendMessage("Right click or press shift to move the camera to your mouse.");
            if (this.facingType === "hatchet") this.sendMessage("Left click to make the tank spin quickly.");
            if (this.settings.hasAnimation === "rmb") this.sendMessage("Right click or press shift to use a special ability.");
            if (this.settings.hasAnimation === "lmb") this.sendMessage("Left click or press space to use a special ability.");
            //if (this.usesAltFire) this.sendMessage("Right click or press shift to fire other weapons.");
            this.sendMessage("You have upgraded to " + this.label + ".");
            for (let o of entities)
                if (o.settings.clearOnMasterUpgrade && o.master.id === this.id && o.id !== this.id && o !== this) o.kill();
            this.skill.update();
            this.refreshBodyAttributes();
            if (this.stealthMode) {
                this.settings.leaderboardable = this.settings.givesKillMessage = false;
                this.alpha = this.ALPHA = 0;
            }
        }
    }
    upgradeTank(tank) {
        this.upgrades = [];
        this.define(tank);
        this.tank = tank;
        if (this.switcherooID === 0 || (this.bossTierType !== -1 && this.bossTierType !== 16)) this.sendMessage("Press Q to switch tiers. There is a 1 second cooldown.");
        if (this.cameraToMouse[0]) this.sendMessage("Right click or press shift to move the camera to your mouse.");
        if (this.facingType === "hatchet") this.sendMessage("Left click to make the tank spin quickly.");
        if (this.settings.hasAnimation === "rmb") this.sendMessage("Right click or press shift to use an animation ability.");
        if (this.settings.hasAnimation === "lmb") this.sendMessage("Left click or press space to use an animation ability.");
        //if (this.usesAltFire) this.sendMessage("Right click or press shift to fire other weapons.");
        this.sendMessage("You have changed your tank to " + this.label + ".");
        this.skill.update();
        this.refreshBodyAttributes();
        setTimeout(() => {
            for (let o of entities)
                if (o.settings.clearOnMasterUpgrade && o.master.id === this.id && o.id !== this.id && o !== this) o.kill();
        }, 25);
        if (this.stealthMode) {
            this.settings.leaderboardable = this.settings.givesKillMessage = false;
            this.alpha = this.ALPHA = 0;
        }
    }
    damageMultiplier() {
        switch (this.type) {
            case "swarm":
                return .25 + 1.5 * util.clamp(this.range / (this.RANGE + 1), 0, 1);
            default:
                return 1;
        }
    }
    move() {
        let g = this.control.goal ? {
                x: this.control.goal.x - this.x,
                y: this.control.goal.y - this.y
            } : {
                x: 0,
                y: 0
            },
            gactive = g.x !== 0 || g.y !== 0,
            engine = {
                x: 0,
                y: 0
            },
            a = this.acceleration / room.speed;
        switch (this.motionType) {
            case "glide":
                this.maxSpeed = this.topSpeed;
                this.damp = .05;
                break;
            case "motor":
                this.maxSpeed = 0;
                if (this.topSpeed) this.damp = a / this.topSpeed;
                if (gactive) {
                    let len = Math.sqrt(g.x * g.x + g.y * g.y);
                    engine = {
                        x: a * g.x / len,
                        y: a * g.y / len
                    };
                }
                break;
            case "swarm":
                this.maxSpeed = this.topSpeed;
                let l = util.getDistance({
                    x: 0,
                    y: 0
                }, g) + 1;
                if (gactive && l > this.size) {
                    let desiredXSpeed = this.topSpeed * g.x / l,
                        desiredYSpeed = this.topSpeed * g.y / l,
                        turning = Math.sqrt((this.topSpeed * Math.max(1, this.range) + 1) / a);
                    engine = {
                        x: (desiredXSpeed - this.velocity.x) / Math.max(5, turning),
                        y: (desiredYSpeed - this.velocity.y) / Math.max(5, turning)
                    };
                } else {
                    if (this.velocity.length < this.topSpeed) engine = {
                        x: this.velocity.x * a / 20,
                        y: this.velocity.y * a / 20
                    };
                }
                break;
            case "chase":
                if (gactive) {
                    let l = util.getDistance({
                        x: 0,
                        y: 0
                    }, g);
                    if (l > this.size * 2) {
                        this.maxSpeed = this.topSpeed;
                        let desiredxspeed = this.topSpeed * g.x / l,
                            desiredyspeed = this.topSpeed * g.y / l;
                        engine = {
                            x: (desiredxspeed - this.velocity.x) * a,
                            y: (desiredyspeed - this.velocity.y) * a
                        };
                    } else this.maxSpeed = 0;
                } else this.maxSpeed = 0;
                break;
            case "drift":
                this.maxSpeed = 0;
                engine = {
                    x: g.x * a,
                    y: g.y * a
                };
                break;
            case "bound":
                let bound = this.bound,
                    ref = this.bond;
                this.x = ref.x + ref.size * bound.offset * Math.cos(bound.direction + bound.angle + ref.facing);
                this.y = ref.y + ref.size * bound.offset * Math.sin(bound.direction + bound.angle + ref.facing);
                this.bond.velocity.x += bound.size * this.accel.x;
                this.bond.velocity.y += bound.size * this.accel.y;
                this.firingArc = [ref.facing + bound.angle, bound.arc / 2];
                this.accel.null();
                this.blend = ref.blend;
                break;
            case "accelerate":
                this.maxSpeed = this.topSpeed;
                this.damp = -.0125;
                this.DAMAGE -= 10; // .05, 1, 2
                break;
            case "glideBall":
                this.maxSpeed = this.topSpeed;
                if (this.topSpeed) this.damp = a / this.topSpeed;
                if (gactive) {
                    let len = Math.sqrt(g.x * g.x + g.y * g.y);
                    engine = {
                        x: a * g.x / len,
                        y: a * g.y / len
                    };
                } else this.damp = .005;
                break;
            case "grow":
                this.SIZE += .175;
                break;
            case "flamethrower":
                this.maxSpeed = this.topSpeed;
                this.damp = -.02;
                this.SIZE += .175;
                this.DAMAGE -= 2.25;
                break;
            case "flare":
                this.maxSpeed = this.topSpeed;
                this.damp = -.025;
                this.SIZE += .25;
                this.DAMAGE -= .175;
                break;
            case "explode":
                this.SIZE += 10;
                this.DAMAGE += 3;
                break;
            case "crockett":
                this.SIZE += 2;
                this.DAMAGE += 2;
            case "snowball":
                this.SIZE += .15;
                this.DAMAGE += 2;
                break;
            case "fatNuke":
                this.SIZE += 7;
                this.DAMAGE += 20;
                break;
            case "miniGrower":
                this.SIZE += .1; // + .02 * Math.random();
                this.DAMAGE += .15;
                this.penetration += .01;
                if (this.velocity.x > 0) this.velocity.x -= .0035;
                if (this.velocity.y > 0) this.velocity.y -= .0035;
                break;
            case "grower":
                this.SIZE += .14; // + .022 * Math.random();
                this.DAMAGE += .175;
                this.penetration += .02;
                if (this.velocity.x > 0) this.velocity.x -= .004;
                if (this.velocity.y > 0) this.velocity.y -= .004;
                break;
            case "megaGrower":
                this.SIZE += .17; // + .024 * Math.random();
                this.DAMAGE += .2;
                this.penetration += .03;
                if (this.velocity.x > 0) this.velocity.x -= .0045;
                if (this.velocity.y > 0) this.velocity.y -= .0045;
                break;
            case "gigaGrower":
                this.SIZE += .21; // + .026 * Math.random();
                this.DAMAGE += .225;
                this.penetration += .04;
                if (this.velocity.x > 0) this.velocity.x -= .005;
                if (this.velocity.y > 0) this.velocity.y -= .005;
                break;
            /*case "gravity":
                //this.a += 1; // Does nothing
                this.velocity.y += a;
                this.damp = -.005;
                this.topSpeed = 90;
                break;*/
            case "gravityA":
                //this.a += 1;
                this.velocity.y += a / 1.45;
                this.damp = -.00125;
                this.topSpeed = 70;
                break;
            case "gravityB":
                //this.a += 1;
                this.velocity.y -= a / 1.45;
                this.damp = -.00125;
                this.topSpeed = 70;
                break;

            case "gravityC":
                this.velocity.y += a / 1.45;
                this.damp = -.00125;
                this.topSpeed = 70;
                break;
            case "gravityD":
                this.velocity.x -= a / 1.45 * Math.sin(2 * Math.PI / 3);
                this.velocity.y += a / 1.45 * Math.cos(2 * Math.PI / 3);
                this.damp = -.00125;
                this.topSpeed = 70;
                break;
            case "gravityE":
                this.velocity.x -= a / 1.45 * Math.sin(4 * Math.PI / 3);
                this.velocity.y += a / 1.45 * Math.cos(4 * Math.PI / 3);
                this.damp = -.00125;
                this.topSpeed = 70;
                break;

            case "limitShrink":
                this.SIZE -= .175;
                if (this.SIZE < 2) this.SIZE = 2;
                break;
            case "decentralize":
                if (this.master.control.alt) this.SIZE += 1;
                else {
                    if (this.SIZE > 25.2) this.SIZE -= 1;
                    else this.SIZE = 25.2;
                }
                break;
            case "plasma":
                this.x = this.source.x;
                this.y = this.source.y;
                this.SIZE += 4;
                break;
            case "colorthingy":
                this.color = 0;
                this.SIZE -= 1;
                if (this.SIZE <= 1) this.kill();
                this.maxSpeed = this.topSpeed;
                break;
            case "colorthingynocolor":
                this.SIZE -= 1;
                if (this.SIZE <= 1) this.kill();
                this.maxSpeed = this.topSpeed;
                break;
            case "decelfast":
                this.maxSpeed = this.topSpeed;
                this.damp = .2;
                break;
            case "colorthingy4":
                this.color = 23;
                this.SIZE += 5;
                if (this.SIZE >= 40) this.SIZE = 40;
                this.guns.color = 4;
                this.maxSpeed = this.topSpeed;
                break;
            case "ebin":
                this.color = 22;
                this.diesAtRange = true;
                let mod = 120 * Math.PI / 180 * Math.sin(900 * Math.random()),
                    theta = this.facing + mod;
                if (this.range <= 40 && this.range >= 39) {
                    this.velocity.x = 10 * Math.cos(theta);
                    this.velocity.y = 10 * Math.sin(theta);
                    mod *= -1;
                }
                this.maxSpeed = this.topSpeed;
                break;
            case "bong":
                this.SIZE += 4;
                this.maxSpeed = this.topSpeed;
                this.damp = .05;
                break;
            case "oxy":
                this.maxSpeed = this.topSpeed;
                let oxy = util.getDistance({
                    x: 0,
                    y: 0
                }, g) + 1;
                if (gactive && oxy > this.size) {
                    let desiredXSpeed = this.topSpeed * g.x / oxy,
                        desiredYSpeed = this.topSpeed * g.y / oxy,
                        turning = Math.sqrt((this.topSpeed * Math.max(1, this.range) + 1) / a);
                    engine = {
                        x: (desiredXSpeed - this.velocity.x) / Math.max(5, turning),
                        y: (desiredYSpeed - this.velocity.y) / Math.max(5, turning)
                    };
                } else {
                    if (this.velocity.length < this.topSpeed) engine = {
                        x: this.velocity.x * a / 20,
                        y: this.velocity.y * a / 20
                    };
                }
                this.color = 31;
                break;
        }
        this.accel.x += engine.x * this.control.power;
        this.accel.y += engine.y * this.control.power;
    }
    face() {
        let t = this.control.target,
            oldFacing = this.facing;
        switch (this.facingType) {
            case "autospin":
                this.facing += .02 / room.speed;
                break;
            case "autospin2":
                this.facing += .0125 / room.speed;
                break;
            case "spinSlowly":
                this.facing += .0075 / room.speed;
                break;
            case "spinSlowly2":
                this.facing += .004 / room.speed;
                break;
            case "spinSlowly3":
                this.facing += .0025 / room.speed;
                break;
            case "spinSlowly4":
                this.facing += .00125 / room.speed;
                break;
            case "bitFastSpin":
                this.facing += .035 / room.speed;
                break;
            case "fastSpin":
                this.facing += .075 / room.speed;
                break;
            case "altSpin":
                this.facing += (this.master.control.alt ? -.15 : .075) / room.speed;
                break;
            case "hadron":
                this.facing += (this.master.control.alt ? -.035 : .035) / room.speed;
                break;
            case "lmg":
                if (this.master.control.fire) this.facing += .0375 / room.speed;
                break;
            case "turnWithSpeed":
                this.facing += this.velocity.length / 90 * Math.PI / room.speed;
                break;
            case "withMotion":
                if (this.velocity.length > 0) this.facing = this.velocity.direction;
                break;
            case "looseWithMotion":
                if (!this.velocity.length) break;
            case "smoothWithMotion":
                this.facing += util.loopSmooth(this.facing, this.velocity.direction, 4 / room.speed);
                break;
            case "toTarget":
                this.facing = Math.atan2(t.y, t.x);
                break;
            case "locksFacing":
                if (!this.control.alt) this.facing = Math.atan2(t.y, t.x);
                break;
            case "altLocksFacing":
                if (!this.control.fire) this.facing = Math.atan2(t.y, t.x);
                break;
            case "smoothToTarget":
                this.facing += util.loopSmooth(this.facing, Math.atan2(t.y, t.x), 4 / room.speed);
                break;
            case "bound":
                let givenAngle;
                if (this.control.main) {
                    givenAngle = Math.atan2(t.y, t.x);
                    let diff = util.angleDifference(givenAngle, this.firingArc[0]);
                    if (Math.abs(diff) >= this.firingArc[1]) givenAngle = this.firingArc[0];
                } else givenAngle = this.firingArc[0];
                this.facing += util.loopSmooth(this.facing, givenAngle, 4 / room.speed);
                if (this.bond.syncTurretSkills) this.skill.set(this.bond.skill.raw);
                break;
            case "hatchet":
                this.facing += .525 + this.skill.spd / 6;
                break;
            case "reverseAutospin":
                this.facing -= .02 / room.speed;
                break;
        }
        let TAU = 2 * Math.PI;
        this.facing = (this.facing % TAU + TAU) % TAU;
        this.vfacing = util.angleDifference(oldFacing, this.facing) * room.speed;
    }
    takeSelfie() {
        this.flattenedPhoto = null;
        this.photo = this.settings.drawShape ? this.camera() : undefined;
    }
    physics() {
        this.velocity.x += this.accel.x;
        this.velocity.y += this.accel.y;
        this.accel.null();
        this.stepRemaining = 1;
        this.x += this.stepRemaining * this.velocity.x / room.speed;
        this.y += this.stepRemaining * this.velocity.y / room.speed;
    }
    friction() {
        let motion = this.velocity.length,
            excess = motion - this.maxSpeed;
        if (excess > 0 && this.damp) {
            let drag = excess / (this.damp / room.speed + 1),
                finalvelocity = this.maxSpeed + drag;
            this.velocity.x = finalvelocity * this.velocity.x / motion;
            this.velocity.y = finalvelocity * this.velocity.y / motion;
        }
    }
    location() {
        if (isNaN(this.x) || isNaN(this.y)) {
            util.error("Detected an NaN position!");
            util.error("Label: " + this.label);
            util.error("Index: " + this.index);
            util.error(`Position: (${this.x}, ${this.y})`);
            util.error(`Velocity: (${this.velocity.x}, ${this.velocity.y})`);
            util.error(`Acceleration: (${this.accel.x}, ${this.accel.y})`);
            return this.kill();
        }
        let loc = {
            x: this.x,
            y: this.y
        };
        if (room.gameMode === "tdm" && this.type !== "food" && this.diesToTeamBase && !this.godmode && !this.passive) {
            let isInTeamBase = false;
            for (let i = 1; i < room.teamAmount + 1; i++)
                if (this.team !== -i && (room.isIn(`bas${i}`, loc) || room.isIn(`n_b${i}`, loc))) {
                    isInTeamBase = true;
                    break;
                }
            if (isInTeamBase) {
                this.velocity.null();
                this.accel.null();
                return setTimeout(() => {
                    if (this.isAlive) this.kill();
                }, 75);
            }
        }
        if (c.PORTALS.ENABLED && room.isIn("port", loc) && !this.passive && !this.settings.goThruObstacle) {
            if (this.motionType === "crockett") return this.kill();
            if (this.settings.isHelicopter) {
                if (!this.godmode && !this.invuln) this.health.amount -= .9;
                return;
            }
            let myRoom = room.isAt(loc),
                dx = loc.x - myRoom.x,
                dy = loc.y - myRoom.y,
                dist2 = dx * dx + dy * dy,
                force = c.BORDER_FORCE;
            if (this.type === "miniboss") {
                this.accel.x += 1e4 * dx / dist2 * force / room.speed;
                this.accel.y += 1e4 * dy / dist2 * force / room.speed;
            } else if (this.type === "tank") {
                if (dist2 <= c.PORTALS.THRESHOLD) {
                    let angle = Math.random() * Math.PI * 2,
                        ax = Math.cos(angle),
                        ay = Math.sin(angle);
                    this.velocity.x = c.PORTALS.LAUNCH_FORCE * ax * force / room.speed;
                    this.velocity.y = c.PORTALS.LAUNCH_FORCE * ay * force / room.speed;
                    let portTo;
                    do portTo = room["port"][Math.floor(Math.random() * room["port"].length)];
                    while (portTo.id === myRoom.id && room["port"].length > 1);
                    let rx = ax < 0 ? -100 : 100,
                        ry = ay < 0 ? -100 : 100;
                    this.x = portTo.x + rx;
                    this.y = portTo.y + ry;
                    for (let o of entities)
                        if (o.id !== this.id && o.master.id === this.id && (o.type === "drone" || o.type === "minion")) {
                            o.x = portTo.x + 320 * ax + 30 * (Math.random() - .5);
                            o.y = portTo.y + 320 * ay + 30 * (Math.random() - .5);
                        }
                } else {
                    this.velocity.x -= c.PORTALS.GRAVITY * dx / dist2 * force / room.speed;
                    this.velocity.y -= c.PORTALS.GRAVITY * dy / dist2 * force / room.speed;
                }
            } else this.kill();
        }
        if (!this.settings.canGoOutsideRoom && !this.passive && this.motionType !== "bound") {
            let force = c.BORDER_FORCE;
            this.accel.x -= Math.min(this.x - this.realSize + 50, 0) * force / room.speed;
            this.accel.x -= Math.max(this.x + this.realSize - room.width - 50, 0) * force / room.speed;
            this.accel.y -= Math.min(this.y - this.realSize + 50, 0) * force / room.speed;
            this.accel.y -= Math.max(this.y + this.realSize - room.height - 50, 0) * force / room.speed;
            if (c.PORTALS.ENABLED && !this.settings.isHelicopter) {
                if (c.PORTALS.DIVIDER_V.ENABLED) {
                    let l = c.PORTALS.DIVIDER_V.LEFT,
                        r = c.PORTALS.DIVIDER_V.RIGHT,
                        m = (l + r) * .5;
                    if (this.x > m && this.x < r) this.accel.x -= Math.min(this.x - this.realSize + 50 - r, 0) * force / room.speed;
                    if (this.x > l && this.x < m) this.accel.x -= Math.max(this.x + this.realSize - 50 - l, 0) * force / room.speed;
                }
                if (c.PORTALS.DIVIDER_H.ENABLED) {
                    let l = c.PORTALS.DIVIDER_H.TOP,
                        r = c.PORTALS.DIVIDER_H.BOTTOM,
                        m = (l + r) * .5;
                    if (this.y > m && this.y < r) this.accel.y -= Math.min(this.y - this.realSize + 50 - r, 0) * force / room.speed;
                    if (this.y > l && this.y < m) this.accel.y -= Math.max(this.y + this.realSize - 50 - l, 0) * force / room.speed;
                }
            }
        }
    }
    death() {
        if (this.bond != null && this.bond.isGhost) return 1;
        if (this.invuln || this.godmode) {
            this.damageReceived = 0;
            return 0;
        }
        if (this.settings.diesAtRange) {
            this.range -= 1 / room.speed;
            if (this.range < 0) this.kill();
        }
        if (this.settings.diesAtLowSpeed && !this.collisionArray.length && this.velocity.length < this.topSpeed / 2) this.health.amount -= this.health.getDamage(1 / room.speed);
        if (this.damageReceived) {
            let healthDamage = this.health.getDamage(this.damageReceived);
            this.blend.amount = 1;
            this.health.amount -= healthDamage;
            if (this.shield.max) {
                let shieldDamage = this.shield.getDamage(this.damageReceived);
                this.damageReceived -= shieldDamage;
                this.shield.amount -= shieldDamage;
            }
        }
        this.damageReceived = 0;
        if (this.isDead()) {
            if (this.onDead != null) this.onDead();
            let killers = [],
                killTools = [],
                notJustFood = false,
                name = this.master.name === "" ? this.master.type === "tank" ?
                "An unnamed player's " + this.label : this.master.type === "miniboss" ?
                "a visiting " + this.label : util.addArticle(this.label) : this.master.name + "'s " + this.label,
                jackpot = Math.ceil(util.getJackpot(this.skill.score) / this.collisionArray.length);
            for (let o of this.collisionArray) {
                if (o.type === "wall" || o.type === "mazeWall") continue;
                if (o.master.isDominator || o.master.isArenaCloser || o.master.label === "Base Protector") killers.push(o.master);
                if (o.master.settings.acceptsScore) {
                    if (o.master.type === "tank" || o.master.type === "miniboss") notJustFood = true;
                    o.master.skill.score += jackpot;
                    killers.push(o.master);
                } else if (o.settings.acceptsScore) o.skill.score += jackpot;
                killTools.push(o);
            }
            killers = killers.filter((elem, index, self) => index === self.indexOf(elem));
            let killText = notJustFood ? "" : "You have been killed by ",
                giveKillMessage = this.settings.givesKillMessage;
            for (let o of killers) {
                this.killCount.killers.push(o.index);
                if (this.type === "tank") {
                    if (killers.length > 1) o.killCount.assists++;
                    else o.killCount.solo++;
                } else if (this.type === "miniboss") o.killCount.bosses++;
            }
            if (notJustFood) {
                for (let o of killers) {
                    if (o.master.type !== "food" && o.master.type !== "crasher") {
                        killText += o.name === "" ? killText === "" ? "An unnamed player" : "An unnamed player" : o.name;
                        killText += " and ";
                    }
                    if (giveKillMessage) o.sendMessage("You" + (killers.length > 1 ? " assist " : " ") + "killed " + name + ".");
                }
                killText = killText.slice(0, -4);
                killText += "killed you with ";
            }
            if (this.settings.broadcastMessage) sockets.broadcast(this.settings.broadcastMessage);
            let toAdd = "";
            for (let o of killTools) {
                if (o.label.includes("Collision")) toAdd = "a Collision and ";
                else toAdd += util.addArticle(o.label) + " and ";
            }
            killText += toAdd;
            killText = killText.slice(0, -5);
            if (killText === "You have been kille") killText = "You have died a stupid death";
            if (this.killedByK) killText = "You killed yourself";
            if (!this.underControl) this.sendMessage(killText + ".");
            if (this.id === room.topPlayerID) {
                let usurptText = this.name || "The leader";
                if (notJustFood) {
                    usurptText += " has been usurped by";
                    for (let o of killers)
                        if (o.type !== "food") {
                            usurptText += " ";
                            usurptText += o.name || "An unnamed player";
                            usurptText += " and";
                        }
                    usurptText = usurptText.slice(0, -4);
                    usurptText += "!";
                } else {
                    if (killers[0] != null) {
                        if (killers[0].isArenaCloser) usurptText += ` suffered by the hands of ${util.addArticle(killers[0].label)}.`;
                        else if (killers[0].label.includes("Base Protector")) usurptText += " strayed too close to a Base Protector.";
                        else usurptText += ` fought ${util.addArticle(killers[0].label)}, and the ${killers[0].label} won.`;
                    }
                    else if (this.killedByK) usurptText += " took the easy way out.";
                    else if (this.isBot) usurptText += " was slaughtered by server code.";
                    else usurptText += " suffered an unknown fate.";
                }
                sockets.broadcast(usurptText);
            }
            return 1;
        }
        return 0;
    }
    protect() {
        entitiesToAvoid.push(this);
        this.isProtected = true;
    }
    sendMessage(message) {}
    kill() {
        this.godmode = false;
        this.invuln = false;
        this.damageReceived = 1e7;
        this.health.amount = 0;
    }
    destroy() {
        if (this.isProtected) util.remove(entitiesToAvoid, entitiesToAvoid.indexOf(this));
        let i = minimap.findIndex(entry => entry[0] === this.id);
        if (i !== -1) util.remove(minimap, i);
        for (let v of views) v.remove(this);
        if (this.parent != null) this.parent.children.splice(this.parent.children.indexOf(this), 1);
        for (let o of entities) {
            if (o.source.id === this.id) {
                if (o.settings.persistsAfterDeath) o.source = o;
                else o.kill();
            }
            if (o.parent && o.parent.id === this.id) o.parent = null;
            if (o.master.id === this.id) {
                o.master = o;
                o.kill();
            }
        }
        for (let turret of this.turrets) turret.destroy();
        this.removeFromGrid();
        this.isGhost = true;
    }
    isDead() {
        return this.health.amount <= 0;
    }
    isAlive() {
        return /*this != null && */this.health.amount > 0 && !this.isGhost;
    }
    toggleRainbow() {
        this.rainbow = !this.rainbow;
        if (this.rainbow) this.intervalID = setInterval(this.rainbowLoop, this.rainbowSpeed);
        else clearInterval(this.intervalID);
    }
    rainbowLoop() {
        if (this.color < 100 || isNaN(this.color)) this.color = 100;
        this.color = (this.color - 100 + 1) % 86 + 100;
        if (this.multibox.enabled)
            for (let o of this.multibox.controlledTanks)
                if (o.isAlive()) o.color = this.color;
    }
    toggleMultibox() {
        this.multibox.intervalID = setInterval(this.multiboxLoop, 500);
    }
    multiboxLoop() {
        this.settings.hitsOwnType = "never";
        for (let controlledBody of this.multibox.controlledTanks)
            if (controlledBody.isAlive()) {
                controlledBody.autoOverride = this.autoOverride;
                controlledBody.passive = this.passive;
                controlledBody.godmode = this.godmode;
                for (let o of entities)
                    if (o.master.id === controlledBody.id && o.id !== controlledBody.id) {
                        o.passive = controlledBody.passive;
                        o.diesToTeamBase = !controlledBody.godmode;
                    }
                controlledBody.skill.set(this.skill.raw);
                controlledBody.refreshBodyAttributes();
                if (controlledBody.skill.score < 59214) {
                    controlledBody.skill.score = this.skill.score;
                    controlledBody.skill.level = this.skill.level;
                }
                if (controlledBody.tank !== this.tank) controlledBody.upgradeTank(this.tank);
                controlledBody.tank = this.tank;
                controlledBody.FOV = .1;
                controlledBody.refreshFOV();
                if (room.gameMode === "tdm") controlledBody.team = this.team;
                else controlledBody.team = this.team = -9;
                controlledBody.color = this.color;
                controlledBody.settings.leaderboardable = false;
                controlledBody.layer = this.layer - .5;
                controlledBody.SIZE = this.SIZE;
                controlledBody.nameColor = this.nameColor;
                controlledBody.alpha = this.alpha;
                controlledBody.ALPHA = this.ALPHA;
            }
    }
    relinquish(player) {
        if (player.body.isMothership) {
            player.body.nameColor = ["#00B0E1", "#F04F54", "#00E06C", "#BE7FF5", "#FFEB8E", "#F37C20", "#E85DDF", "#8EFFFB"][player.team - 1];
            player.body.controllers = [];
        } else {
            player.body.controllers = [new io_nearestDifferentMaster(player.body), new io_spinWhileIdle(player.body)];
            player.body.nameColor = "#FFFFFF";
            if (player.body.label === "Trapper Dominator") {
                player.body.addController(new io_alwaysFire(player.body));
                player.body.facingType = "autospin";
            }
        }
        player.body.name = "";
        player.body.underControl = false;
        player.body.sendMessage = content => {};
        let fakeBody = new Entity({
            x: player.body.x,
            y: player.body.y
        });
        fakeBody.passive = true;
        fakeBody.underControl = true;
        player.body = fakeBody;
        player.body.kill();
    }
    runAnimations(gun) {
        let onShoot = gun.onShoot;
        switch (onShoot) {
            case "crescent":
                if (this.isAlive()) this.define(Class.crescentFire);
                break;
            case "revo":
                if (this.isAlive()) this.define(Class.baseThrowerFire);
                break;
            case "mei":
                if (this.isAlive()) this.define(Class.meiFire);
                break;
            case "kashmir":
                if (this.isAlive()) this.define(Class.kashmir1);
                break;
            case "aka":
            case "aka2":
                for (let i = 1; i < 31; i++) setTimeout(() => {
                    if (this.isAlive()) {
                        if (i !== 31) this.upgrades = [];
                        this.define(Class[`aka${onShoot === "aka" ? i : 30 - i}`]);
                    }
                }, 14 * i);
                break;
            case "trap":
            case "trap2":
                for (let i = 1; i < 82; i++) setTimeout(() => {
                    if (this.isAlive()) {
                        if (onShoot === "trap2" && i === 81) this.upgrades = [];
                        this.define(Class[`trapeze${onShoot === "trap" ? i : 81 - i}`]);
                    }
                }, 7 * i);
                break;
            case "exteng":
            case "exteng2":
                for (let i = 1; i < 41; i++) setTimeout(() => {
                    if (this.isAlive()) this.define(Class[`exteng${onShoot === "exteng" ? i : 40 - i}`]);
                }, 28 * i);
                break;
            case "hepta":
            case "hepta2":
                for (let i = 1; i < 32; i++) setTimeout(() => {
                    if (this.isAlive()) this.define(Class[`heptazoid${onShoot === "hepta" ? i : 31 - i}`]);
                }, 7 * i);
                break;
            case "sab":
            case "sab2":
                for (let i = 1; i < 31; i++) setTimeout(() => {
                    if (this.isAlive()) this.define(Class[`sab${onShoot === "sab" ? i : 30 - i}`]);
                }, 14 * i);
                break;
            case "ek":
            case "ek2":
                for (let i = 1; i < 102; i++) setTimeout(() => {
                    if (this.isAlive()) this.define(Class[`ekAnim${onShoot === "ek" ? i : 101 - i}`]);
                }, 36 * i);
                break;
            case "nok":
            case "nok2":
                for (let i = 1; i < 31; i++) setTimeout(() => {
                    if (this.isAlive()) this.define(Class[`nok${onShoot === "nok" ? i : 30 - i}`]);
                }, 14 * i);
                break;
            case "tam":
            case "tam2":
                for (let i = 1; i < 31; i++) setTimeout(() => {
                    if (this.isAlive()) this.define(Class[`tam${onShoot === "tam" ? i : 30 - i}`]);
                }, 14 * i);
                break;
            case "hand":
            case "hand2":
            case "hand3":
            case "hand4":
                {
                    let increment = onShoot === "hand2" ? 20 : onShoot === "hand3" ? 40 : onShoot === "hand4" ? 60 : 0,
                        tank = this.label === "Auto-Glove" ? "autoHandBasic" : "handBasic";
                    for (let i = 1; i < 21; i++) setTimeout(() => {
                        if (this.isAlive()) this.define(Class[`${tank}${i + increment}`]);
                    }, this.skill.rld * 20 * i); // 9.5
                }
                break;
            case "hand5":
                this.upgrades = [];
                if (this.isAlive()) this.define(this.label === "Auto-Glove" ? Class.autoHandBasic0 : Class.handBasic0);
                break;
            case "oxy":
                if (this.isAlive()) this.define(Class.greenGuardianLauncher);
                break;
            case "bite":
            case "bite2":
                for (let i = 1; i < 31; i++) setTimeout(() => {
                    if (this.isAlive()) this.define(Class[`bite${onShoot === "bite" ? i : 30 - i}`]);
                }, 14 * i);
                break;
            case "mar":
            case "mar2":
                for (let i = 1; i < 31; i++) setTimeout(() => {
                    if (this.isAlive()) this.define(Class[`mar${onShoot === "mar" ? i : 30 - i}`]);
                }, 14 * i);
                break;
            case "zke":
            case "zke2":
                for (let i = 1; i < 32; i++) setTimeout(() => {
                    if (this.isAlive()) this.define(Class[`zke${onShoot === "zke" ? i : 31 - i}`]);
                }, 14 * i);
                break;
            case "val":
            case "val2":
                for (let i = 1; i < 32; i++) setTimeout(() => {
                    if (this.isAlive()) this.define(Class[`val${onShoot === "val" ? i : 31 - i}`]);
                }, 14 * i);
                break;
            case "inject":
                setTimeout(() => {
                    if (this.isAlive()) {
                        let tank = this.label === "Atrophy" ? "atrophy" : "inject";
                        this.define(Class[`${tank}${gun.inject + 1}`]);
                    }
                }, (Math.exp(this.skill.rld) - 1) * 46);
                break;
            case "inject2":
                for (let i = 32; i < 62; i++) setTimeout(() => {
                    if (this.isAlive()) {
                        let tank = this.label === "Atrophy" ? "atrophy" : "inject";
                        if (i === 61) this.upgrades = [];
                        this.define(Class[`${tank}${i === 61 ? 0 : i}`]);
                    }
                }, 5 / this.skill.rld * i);
                break;
            case "steyr":
            case "steyr2":
                for (let i = 1; i < 32; i++) setTimeout(() => {
                    if (this.isAlive()) this.define(Class[`steyr${onShoot === "steyr" ? i : 31 - i}`]);
                }, 14 * i);
                break;
            case "cas":
            case "cas2":
                for (let i = 1; i < 49; i++) setTimeout(() => {
                    if (this.isAlive()) this.define(Class[`castano${onShoot === "cas" ? i : 48 - i}`]);
                }, 28 * i);
                break;
            case "redis":
            case "redis2":
                for (let i = 1; i < 32; i++) setTimeout(() => {
                    if (this.isAlive()) this.define(Class[`trired${onShoot === "redis" ? i : 31 - i}`]);
                }, 14 * i);
                break;
            case "engi":
            case "engi2":
                for (let o of entities)
                    if (o.master.id === this.id && o.type === "drone") o.kill();
                for (let i = 1; i < 32; i++) setTimeout(() => {
                    if (this.isAlive()) this.define(Class[`engilord${onShoot === "engi" ? i : 31 - i}`]);
                }, 28 * i);
                break;
            case "hybranger":
            case "hybranger2":
                for (let o of entities)
                    if (o.master.id === this.id && o.type === "drone") o.kill();
                for (let i = 1; i < 32; i++) setTimeout(() => {
                    if (this.isAlive()) this.define(Class[`hybranger${onShoot === "hybranger" ? i : (i === 31 ? 0 : i + 31)}`]);
                }, 14 * i);
                break;
            case "stick":
            case "stick2":
                for (let i = 1; i < 32; i++) setTimeout(() => {
                    if (this.isAlive()) this.define(Class[`stick${onShoot === "stick" ? i : 31 - i}`]);
                }, 14 * i);
                break;
            case "what":
                for (let i = 1; i < 16; i++) setTimeout(() => {
                    if (this.isAlive()) this.define(Class[`whatever${i}`]);
                }, 14 * i);
                break;
            case "what2":
                for (let i = 16; i < 32; i++) setTimeout(() => {
                    if (this.isAlive()) this.define(Class[`whatever${i}`]);
                }, 14 * (i - 15));
                break;
            case "what3":
                for (let i = 32; i < 63; i++) setTimeout(() => {
                    if (this.isAlive()) this.define(Class[`whatever${i === 62 ? 0 : i}`]);
                }, 14 * (i - 31));
                break;
            case "shape":
            case "shape2":
                for (let o of entities)
                    if (o.master.id === this.id && o.type === "drone") o.kill();
                for (let i = 1; i < 32; i++) setTimeout(() => {
                    if (this.isAlive()) this.define(Class[`shapeChange${onShoot === "shape" ? i : 31 - i}`]);
                }, 14 * i);
                break;
            case "misi":
            case "misi2":
                for (let i = 1; i < 32; i++) setTimeout(() => {
                    if (this.isAlive()) this.define(Class[`misitor${onShoot === "misi" ? i : 31 - i}`]);
                }, 14 * i);
                break;
            case "surge":
            case "surge2":
                for (let i = 1; i < 21; i++) setTimeout(() => {
                    if (this.isAlive()) this.define(Class[`sniperEMP${onShoot === "surge" ? i : 20 + i}`]);
                }, this.skill.rld * (onShoot === "surge" ? 180 : 60) * i);
                break;
            case "surge3":
                if (this.isAlive()) this.define(Class.sniperEMP0);
                break;
            case "vymp":
            case "vymp2":
            case "vymp3":
                for (let i = 1; i < 31; i++) setTimeout(() => {
                    if (this.isAlive()) {
                        if (onShoot === "vymp3" && i === 30) this.define(Class.skimketster0);
                        else this.define(Class[`skimketster${onShoot === "vymp" ? i : onShoot === "vymp2" ? 30 + i : 60 + i}`]);
                    }
                }, 24 * i);
                break;
            case "led":
            case "led2":
                for (let i = 1; i < 32; i++) setTimeout(() => {
                    if (this.isAlive()) this.define(Class[`ledZeppelin${onShoot === "led" ? i : 31 - i}`]);
                }, 14 * i);
                break;
            case "extend":
            case "extend2":
                for (let i = 1; i < 31; i++) setTimeout(() => {
                    if (this.isAlive()) this.define(Class[`basicRanger${onShoot === "extend" ? i : 30 - i}`]);
                }, 18 * i);
                break;
            case "par":
            case "par2":
                for (let i = 1; i < 31; i++) setTimeout(() => {
                    if (this.isAlive()) this.define(Class[`par${onShoot === "par" ? i : 30 - i}`]);
                }, 14 * i);
                break;
            case "penta":
            case "penta2":
                for (let i = 1; i < 32; i++) setTimeout(() => {
                    if (this.isAlive()) this.define(Class[`pentaBoost${onShoot === "penta" ? i : 31 - i}`]);
                }, 14 * i);
                break;
            default:
                util.warn("Unknown ON_SHOOT value: " + onShoot + "!");
                onShoot = null;
        };
    }
}
const logs = (() => {
    const logger = (() => {
        const set = obj => {
            obj.time = util.time();
        };
        const mark = obj => {
            obj.data.push(util.time() - obj.time);
        };
        const record = obj => {
            let o = util.averageArray(obj.data);
            obj.data = [];
            return o;
        };
        const sum = obj => {
            let o = util.sumArray(obj.data);
            obj.data = [];
            return o;
        };
        const tally = obj => {
            obj.count++;
        };
        const count = obj => {
            let o = obj.count;
            obj.count = 0;
            return o;
        };
        return () => {
            let internal = {
                data: [],
                time: util.time(),
                count: 0
            };
            return {
                set: () => set(internal),
                mark: () => mark(internal),
                record: () => record(internal),
                sum: () => sum(internal),
                count: () => count(internal),
                tally: () => tally(internal)
            };
        };
    })();
    return {
        entities: logger(),
        collide: logger(),
        network: logger(),
        minimap: logger(),
        //misc2: logger(),
        //misc3: logger(),
        physics: logger(),
        life: logger(),
        selfie: logger(),
        master: logger(),
        activation: logger(),
        loops: logger()
    };
})();
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const app = express();
const blockerDB = require("./lib/database/blocker");
const parseIPv4 = ip => {
    let [a, b, c, d] = ip.split(".").map(r => parseInt(r, 10));
    return (a << 24) | (b << 16) | (c << 8) | d;
};
const IPv4BadASNBlocks = fs.readFileSync("./lib/database/GeoLite2-ASN-Blocks-IPv4.csv", "utf8").trim().split("\n").slice(1).map(line => {
    let [ip, mask, asn] = line.split(/[,/]/);
    return {
        ip: parseIPv4(ip),
        mask: +mask,
        asn: +asn
    };
}).filter(line => blockerDB.badASNs.includes(line[1]));
const binarySearch = (array, compare) => {
    let m = 0,
        n = array.length - 1;
    while (m <= n) {
        let k = (n + m) >> 1,
            cmp = compare(array[k]);
        if (cmp > 0) m = k + 1;
        else if (cmp < 0) n = k - 1;
        else return k;
    }
    return -m - 1;
};
const exportDefintionsToClient = (() => {
    const rounder = v => {
        if (Math.abs(v) < .00001) v = 0;
        return +v.toPrecision(6);
    };
    const getMockup = (e, p) => {
        return {
            index: e.index,
            name: e.label,
            x: rounder(e.x),
            y: rounder(e.y),
            color: e.color,
            shape: e.shape,
            size: rounder(e.size),
            realSize: rounder(e.realSize),
            facing: rounder(e.facing),
            layer: e.layer,
            statnames: e.settings.skillNames,
            position: p,
            upgrades: e.upgrades.map(r => ({
                tier: r.tier,
                index: r.index + room.manualOffset
            })),
            guns: e.guns.map(g => {
                return {
                    offset: rounder(g.offset),
                    direction: rounder(g.direction),
                    length: rounder(g.length),
                    width: rounder(g.width),
                    aspect: rounder(g.aspect),
                    angle: rounder(g.angle),
                    color: rounder(g.color),
                    skin: rounder(g.skin),
                    color_unmix: rounder(g.color_unmix)
                };
            }),
            turrets: e.turrets.map(t => {
                let out = getMockup(t, {});
                out.sizeFactor = rounder(t.bound.size);
                out.offset = rounder(t.bound.offset);
                out.direction = rounder(t.bound.direction);
                out.layer = rounder(t.bound.layer);
                out.angle = rounder(t.bound.angle);
                return out;
            })
        };
    };
    const getDimensions = e => {
        let endpoints = [],
            pointDisplay = [];
        const pushEndpoints = (model, scale, focus = {x: 0, y: 0}, rot = 0) => {
            let s = Math.abs(model.shape),
                z = Math.abs(s) > realSizes.length ? 1 : realSizes[Math.abs(s)];
            if (z === 1) {
                for (let i = 0; i < 2; i += .5) endpoints.push({
                    x: focus.x + scale * Math.cos(i * Math.PI),
                    y: focus.y + scale * Math.sin(i * Math.PI)
                });
            } else for (let i = (s % 2) ? 0 : Math.PI / s; i < s; i++) {
                let theta = (i / s) * 2 * Math.PI;
                endpoints.push({
                    x: focus.x + scale * z * Math.cos(theta),
                    y: focus.y + scale * z * Math.sin(theta)
                });
            }
            for (let i = 0; i < model.guns.length; i++) {
                let gun = model.guns[i],
                    h = gun.aspect > 0 ? scale * gun.width / 2 * gun.aspect : scale * gun.width / 2,
                    r = Math.atan2(h, scale * gun.length) + rot,
                    l = Math.sqrt(scale * scale * gun.length * gun.length + h * h),
                    x = focus.x + scale * gun.offset * Math.cos(gun.direction + gun.angle + rot),
                    y = focus.y + scale * gun.offset * Math.sin(gun.direction + gun.angle + rot);
                endpoints.push({
                    x: x + l * Math.cos(gun.angle + r),
                    y: y + l * Math.sin(gun.angle + r)
                });
                endpoints.push({
                    x: x + l * Math.cos(gun.angle - r),
                    y: y + l * Math.sin(gun.angle - r)
                });
                pointDisplay.push({
                    x: x + l * Math.cos(gun.angle + r),
                    y: y + l * Math.sin(gun.angle + r)
                });
                pointDisplay.push({
                    x: x + l * Math.cos(gun.angle - r),
                    y: y + l * Math.sin(gun.angle - r)
                });
            }
            for (let i = 0; i < model.turrets.length; i++) {
                let turret = model.turrets[i];
                pushEndpoints(
                    turret,
                    turret.bound.size,
                    {
                        x: turret.bound.offset * Math.cos(turret.bound.angle),
                        y: turret.bound.offset * Math.sin(turret.bound.angle)
                    },
                    turret.bound.angle
                );
            }
        };
        pushEndpoints(e, 1);
        let massCenter = {
            x: 0,
            y: 0
        };
        const getFurthest = furthestFrom => {
            let index = 0;
            if (furthestFrom !== -1) {
                let list = new PriorityQueue(),
                    d;
                for (let i = 0; i < endpoints.length; i++) {
                    let thisPoint = endpoints[i];
                    d = Math.pow(thisPoint.x - furthestFrom.x, 2) + Math.pow(thisPoint.y - furthestFrom.y, 2) + 1;
                    list.enqueue(1 / d, i);
                }
                index = list.dequeue();
            }
            let output = endpoints[index];
            endpoints.splice(index, 1);
            return output;
        };
        let point1 = getFurthest(massCenter),
            point2 = getFurthest(point1);
        const getBiggestTri = (point1, point2) => {
            let list = new PriorityQueue(),
                index = 0;
            for (let i = 0; i < endpoints.length; i++) {
                let thisPoint = endpoints[i],
                    a = Math.pow(thisPoint.x - point1.x, 2) + Math.pow(thisPoint.y - point1.y, 2) + Math.pow(thisPoint.x - point2.x, 2) + Math.pow(thisPoint.y - point2.y, 2);
                list.enqueue(1 / a, i);
            }
            index = list.dequeue();
            let output = endpoints[index];
            endpoints.splice(index, 1);
            return output;
        };
        let point3 = getBiggestTri(point1, point2);
        const threePointCircle = (p1, p2, p3) => {
            let x1 = p1.x,
                y1 = p1.y,
                x2 = p2.x,
                y2 = p2.y,
                x3 = p3.x,
                y3 = p3.y,
                denom = x1 * (y2 - y3) - y1 * (x2 - x3) + x2 * y3 - x3 * y2,
                xy1 = x1 * x1 + y1 * y1,
                xy2 = x2 * x2 + y2 * y2,
                xy3 = x3 * x3 + y3 * y3,
                x = (xy1 * (y2 - y3) + xy2 * (y3 - y1) + xy3 * (y1 - y2)) / (2 * denom),
                y = (xy1 * (x3 - x2) + xy2 * (x1 - x3) + xy3 * (x2 - x1)) / (2 * denom),
                r = Math.sqrt(Math.pow(x - x1, 2) + Math.pow(y - y1, 2)); // Math.hypot
            return {
                x: x,
                y: y,
                radius: r
            };
        };
        let circle = threePointCircle(point1, point2, point3);
        pointDisplay = [{
            x: rounder(point1.x),
            y: rounder(point1.y)
        }, {
            x: rounder(point2.x),
            y: rounder(point2.y)
        }, {
            x: rounder(point3.x),
            y: rounder(point3.y)
        }];
        let center = {
                x: circle.x,
                y: circle.y
            },
            radius = circle.radius;
        const checkPoints = () => {
            for (let i = endpoints.length; i > 0; i--) {
                point1 = getFurthest(center);
                let toCenter = new Vector(center.x - point1.x, center.y - point1.y);
                if (toCenter.length > radius) {
                    pointDisplay.push({
                        x: rounder(point1.x),
                        y: rounder(point1.y)
                    });
                    let dir = toCenter.direction;
                    point2 = {
                        x: center.x + radius * Math.cos(dir),
                        y: center.y + radius * Math.sin(dir)
                    };
                    break;
                }
            }
            return !!endpoints.length;
        };
        while (checkPoints()) {
            radius = {
                x: (point1.x + point2.x) / 2,
                y: (point1.y + point2.y) / 2
            };
            radius = Math.sqrt(Math.pow(point1.x - point2.x, 2) + Math.pow(point1.y - point2.y, 2)) / 2; // Math.hypot
        }
        return {
            middle: {
                x: rounder(center.x),
                y: 0
            },
            axis: rounder(radius * 2),
            points: pointDisplay
        };
    };
    let data = [];
    for (let k of Object.keys(Class)) try {
        let temp = Class[k],
            o = new Entity({
                x: 0,
                y: 0
            });
        o.define(temp);
        o.name = temp.LABEL;
        temp.mockup = {
            body: o.camera(true),
            position: getDimensions(o)
        };
        temp.mockup.body.position = temp.mockup.position;
        data.push(getMockup(o, temp.mockup.position));
        o.destroy();
    } catch (e) {
        util.error(e);
        util.error(k);
        util.error(Class[k]);
    }
    purgeEntities();
    let toWrite = JSON.stringify(data);
    return loc => {
        util.log("Preparing definition exports...");
        fs.writeFileSync(loc, toWrite, "utf8", err => {
            if (err) return util.error(err);
        });
        util.log("Mockups written to " + loc + ".");
    };
})();

exportDefintionsToClient(__dirname + `/../client/json/mockups${serverPrefix}.json`);
if (c.servesStatic) app.use(express.static(__dirname + "/../client"));

const sockets = (() => {
    const protocol = require("./lib/fasttalk");
    return {
        broadcast: (message, color = "") => {
            for (let socket of clients) socket.talk("m", message, color);
        },
        broadcastRoom: () => {
            for (let socket of clients) socket.talk("r", room.width, room.height, JSON.stringify(c.ROOM_SETUP));
        },
        connect: (() => {
            const close = socket => {
                let n = connectedIPs.findIndex(w => w.ip === socket.ip);
                if (n !== -1) {
                    if (connectedIPs[n].number > 1) connectedIPs[n].number--;
                    else util.remove(connectedIPs, n);
                }
                let player = socket.player,
                    index = players.indexOf(player),
                    body = player.body;
                if (index !== -1) {
                    let below5000 = false;
                    if (body != null && body.skill.score < 5000) below5000 = true;
                    setTimeout(() => {
                        if (body != null) {
                            if (body.underControl) body.relinquish(player);
                            else body.kill();
                        }
                    }, below5000 ? 1 : c.disconnectDeathTimeout);
                    util.remove(players, index);
                    util.info(socket.name + " has disconnected! IP: " + socket.ip + ". Players: " + clients.length + ".");
                    if (socket.inactivityTimeout != null) socket.endTimeout();
                }
                util.remove(views, views.indexOf(socket.view));
                util.remove(clients, clients.indexOf(socket));
            };
            const kick = (socket, reason = "Unspecified.") => {
                util.warn(`${reason} Player has been disconnected. IP: ${socket.ip}.`);
                socket.lastWords("K");
            };
            const ban = (socket, reason = "Unspecified.", secondaryReason = "Unspecified.") => {
                util.warn("A player with the IP " + socket.ip + " has been banned! Player has been disconnected.");
                if (!bannedIPs[0].includes(socket.ip)) {
                    bannedIPs[0].push(socket.ip);
                    bannedIPs[1].push(secondaryReason);
                }
                socket.lastWords("K");
            };
            const error = (socket, type = "unknown", reason = "unspecified", report = false) => {
                socket.talk("P", `Something went wrong during the ${type} process: ${reason}. ${report ? "Please report this bug if it continues to occur." : ""}`);
                socket.kick(reason + "!");
            };
            const incoming = (message, socket) => {
                if (!(message instanceof ArrayBuffer)) {
                    socket.error("initialization", "Non-binary packet", true);
                    return 1;
                }
                let m = protocol.decode(message);
                if (m == null || m === -1) {
                    socket.error("initialization", "Malformed packet", true);
                    return 1;
                }
                socket.status.requests++;
                let player = socket.player,
                    body = player.body,
                    isAlive = body != null && body.health.amount > 0 && !body.isGhost,
                    index = m.shift();
                switch (index) {
                    case "k": // Verify socket and token
                        {
                            if (room.arenaClosed) return;
                            if (m.length !== 1) {
                                socket.error("token verification", "Ill-sized token request", true);
                                return 1;
                            }
                            let key = m[0];
                            if (typeof key !== "string") {
                                socket.error("token verification", "Non-string token was offered");
                                return 1;
                            }
                            if (key.length > 64) {
                                socket.error("token verification", "Overly-long token offered");
                                return 1;
                            }
                            if (socket.status.verified) {
                                socket.error("spawn", "Duplicate spawn attempt", true);
                                return 1;
                            }
                            socket.key = key.substr(0, 64);
                            let isBetaTester = BETA_TOKENS_1.includes(socket.key) || BETA_TOKENS_2.includes(socket.key) || BETA_TOKENS_3.includes(socket.key);
                            if (clients.length >= c.connectionLimit || players.length >= c.connectionLimit) {
                                if (isBetaTester) util.warn("A player with the token " + socket.key + " has bypassed the connection limit!");
                                else {
                                    socket.talk("P", `The connection limit (${c.connectionLimit} Players) has been reached. Please try again later.`);
                                    socket.kick("Connection limit reached!");
                                    return 1;
                                }
                            }
                            if (!isBetaTester && binarySearch(IPv4BadASNBlocks, ({ip, mask, asn}) => {
                                let dbOut = ip >>> (32 - mask),
                                    ipOut = parseIPv4(socket.ip.slice(7)) >>> (32 - mask);
                                return ipOut - dbOut;
                            }) >= 0 || blockerDB.torIPs.includes(socket.ip.slice(7))) {
                                socket.talk("P", "VPN detected. Please disable your VPN to join the game.");
                                socket.kick("VPN detected with IP: " + socket.ip + "!");
                                return 1;
                            }
                            if (!isBetaTester && room.testingMode) {
                                socket.talk("P", "This server is currently closed to the public; no players may join.");
                                socket.kick("A player tried to connect to the server in testing mode!");
                                return 1;
                            }
                            socket.verified = true;
                            socket.talk("w", true);
                            if (key) util.info("A socket was verified with the token: " + key + ".");
                        }
                        break;
                    case "s": // Spawn request
                        {
                            if (!socket.status.deceased) {
                                socket.error("spawn", "Trying to spawn while already alive", true);
                                return 1;
                            }
                            if (m.length !== 2) {
                                socket.error("spawn", "Ill-sized spawn request", true);
                                return 1;
                            }
                            let name = BETA_TOKENS_3.includes(socket.key) ? m[0] : m[0].replace(new RegExp(c.BANNED_REGEX_BODY, c.BANNED_REGEX_FLAGS), "").trim(),
                                isNew = m[1];
                            if (room.arenaClosed) {
                                socket.talk("P", `The arena is closed. You may ${isNew ? "join" : "rejoin"} once the server restarts.`);
                                socket.kick("A player tried to spawn when the arena is closed!");
                                return 1;
                            }
                            if (typeof name !== "string") {
                                socket.error("spawn", "Non-string name provided", true);
                                return 1;
                            }
                            if (encodeURI(name).split(/%..|./).length > 48) {
                                socket.error("spawn", "Overly-long name");
                                return 1;
                            }
                            if (isNew !== 0 && isNew !== 1) {
                                socket.error("spawn", "Invalid isNew value", true);
                                return 1;
                            }
                            for (let text of blockedNames)
                                if (name.toLowerCase().includes(text)) {
                                    socket.error("spawn", "Inappropriate name (" + trimName(name) + ")");
                                    return 1;
                                }
                            socket.status.deceased = false;
                            if (players.indexOf(socket.player) !== -1) util.remove(players, players.indexOf(socket.player));
                            if (views.indexOf(socket.view) !== -1) {
                                util.remove(views, views.indexOf(socket.view));
                                socket.makeView();
                            }
                            socket.player = socket.spawn(name);
                            if (isNew) socket.talk("R", room.width, room.height, JSON.stringify(c.ROOM_SETUP), JSON.stringify(util.serverStartTime), room.speed);
                            socket.update(0);
                            util.info(trimName(m[0]) + (isNew ? " joined" : " rejoined") + " the game! IP: " + socket.ip + ". Player ID: " + (entitiesIdLog - 1) + ". Players: " + clients.length + ".");
                            socket.spawnCount += 1;
                            socket.name = trimName(m[0]);
                            if (socket.inactivityTimeout != null) socket.endTimeout();
                        }
                        break;
                    case "S": // Clock syncing
                        {
                            if (m.length !== 1) {
                                socket.error("clock-syncing", "Ill-sized sync packet", true);
                                return 1;
                            }
                            let syncTick = m[0];
                            if (typeof syncTick !== "number") {
                                socket.error("clock-syncing", "Non-numeric sync value", true);
                                return 1;
                            }
                            socket.talk("S", syncTick, util.time());
                        }
                        break;
                    case "p": // Calc ping
                        {
                            if (m.length !== 1) {
                                socket.error("ping calculation", "Ill-sized ping", true);
                                return 1;
                            }
                            let ping = m[0];
                            if (typeof ping !== "number") {
                                socket.error("ping calculation", "Non-numeric ping value", true);
                                return 1;
                            }
                            socket.talk("p", m[0]);
                            socket.status.lastHeartbeat = util.time();
                        }
                        break;
                    case "C": // Command packet
                        {
                            if (m.length !== 3) {
                                socket.error("command handling", "Ill-sized command packet", true);
                                return 1;
                            }
                            let target = {
                                    x: m[0],
                                    y: m[1]
                                },
                                commands = m[2];
                            if (typeof target.x !== "number" || typeof target.y !== "number" || typeof commands !== "number") {
                                socket.error("command handling", "Non-numeric command value", true);
                                return 1;
                            }
                            if (commands > 255 || !target.x || !target.y || target.x !== Math.round(target.x) || target.y !== Math.round(target.y)) return 0;
                            player.target = target;
                            let val = [false, false, false, false, false, false, false, false];
                            for (let i = 7; i >= 0; i--)
                                if (commands >= Math.pow(2, i)) {
                                    commands -= Math.pow(2, i);
                                    val[i] = true;
                                }
                            try {
                                player.command.up = val[0];
                                player.command.down = val[1];
                                player.command.left = val[2];
                                player.command.right = val[3];
                                player.command.lmb = val[4];
                                player.command.mmb = val[5];
                                player.command.rmb = val[6];
                            } catch (e) {
                                util.error(e);
                                return 1;
                            }
                        }
                        break;
                    case "t": // Player toggle
                        {
                            if (m.length !== 1) {
                                socket.error("control toggle", "Ill-sized toggle", true);
                                return 1;
                            }
                            let given = "",
                                tog = m[0];
                            if (typeof tog !== "number") {
                                socket.error("control toggle", "Non-numeric toggle value", true);
                                return 1;
                            }
                            if (!isAlive) return;
                            switch (tog) {
                                case 0:
                                    given = "autospin";
                                    break;
                                case 1:
                                    given = "autofire";
                                    break;
                                case 2:
                                    given = "override";
                                    break;
                                default:
                                    socket.error("control toggle", `Unknown toggle value (${tog})`, true);
                                    return 1;
                            }
                            if (player.command != null) {
                                player.command[given] = !player.command[given];
                                body.sendMessage(given.charAt(0).toUpperCase() + given.slice(1) + (player.command[given] ? ": ON" : ": OFF"));
                            }
                        }
                        break;
                    case "U": // Upgrade request
                        {
                            if (m.length !== 1) {
                                socket.error("tank upgrade", "Ill-sized tank upgrade request", true);
                                return 1;
                            }
                            let num = m[0];
                            if (typeof num !== "number" || num < 0) {
                                socket.error("tank upgrade", `Invalid tank upgrade value (${num})`, true);
                                return 1;
                            }
                            if (body != null) body.upgrade(num);
                        }
                        break;
                    case "x": // Skill upgrade request
                        {
                            if (m.length !== 1) {
                                socket.error("skill upgrade", "Ill-sized skill upgrade request", true);
                                return 1;
                            }
                            let num = m[0],
                                stat = "";
                            if (typeof num !== "number") {
                                socket.error("skill upgrade", "Non-numeric stat upgrade value", true);
                                return 1;
                            }
                            if (!isAlive) break;
                            switch (num) {
                                case 0:
                                    stat = "atk";
                                    break;
                                case 1:
                                    stat = "hlt";
                                    break;
                                case 2:
                                    stat = "spd";
                                    break;
                                case 3:
                                    stat = "str";
                                    break;
                                case 4:
                                    stat = "pen";
                                    break;
                                case 5:
                                    stat = "dam";
                                    break;
                                case 6:
                                    stat = "rld";
                                    break;
                                case 7:
                                    stat = "mob";
                                    break;
                                case 8:
                                    stat = "rgn";
                                    break;
                                case 9:
                                    stat = "shi";
                                    break;
                                default:
                                    socket.error("skill upgrade", `Unknown skill upgrade value (${num})`, true);
                                    return 1;
                            }
                            body.skillUp(stat);
                        }
                        break;
                    case "z": // Leaderboard desync report
                        {
                            if (m.length !== 0) {
                                socket.error("leaderboard", "Ill-sized leaderboard desync request", true);
                                return 1;
                            }
                            socket.status.needsFullLeaderboard = true;
                        }
                        break;
                    case "l": // Control a Dominator or Mothership (should be simplified at some point)
                        {
                            if (m.length !== 0) {
                                socket.error("Dominator/Mothership control", "Ill-sized control request", true);
                                return 1;
                            }
                            if (room.gameMode !== "tdm" || !isAlive) return;
                            if (c.serverName.includes("Domination")) {
                                if (!body.underControl) {
                                    let choices = [];
                                    for (let o of entities)
                                        if (o.isDominator && o.team === player.body.team && !o.underControl) choices.push(o);
                                    if (!choices.length) return player.body.sendMessage("No Dominators are available on your team to control.");
                                    let dominator = choices[Math.floor(Math.random() * choices.length)],
                                        name = body.name,
                                        nameColor = body.nameColor;
                                    dominator.underControl = true;
                                    player.body = dominator;
                                    body.controllers = [];
                                    body.passive = false;
                                    setTimeout(() => {
                                        if (body != null) {
                                            body.miscIdentifier = "No Death Log";
                                            body.kill();
                                        }
                                    }, 5000);
                                    player.body.name = name;
                                    player.body.nameColor = nameColor;
                                    player.body.sendMessage = content => socket.talk("m", content);
                                    player.body.controllers = [new io_listenToPlayerStatic(player.body, player)];
                                    player.body.FOV = 1;
                                    player.body.refreshFOV();
                                    player.body.invuln = player.body.godmode = player.body.passive = false;
                                    player.body.facingType = player.body.label === "Auto-Dominator" ? "autospin" : "toTarget";
                                    player.body.sendMessage("Press H or reload your game to relinquish control of the Dominator.");
                                    player.body.sendMessage("You are now controlling the " + room.cardinals[Math.floor(3 * player.body.y / room.height)][Math.floor(3 * player.body.x / room.height)] + " Dominator!");
                                } else {
                                    let loc = room.cardinals[Math.floor(3 * player.body.y / room.height)][Math.floor(3 * player.body.x / room.height)];
                                    player.body.sendMessage("You have relinquished control of the " + loc + " Dominator.");
                                    player.body.FOV = .5;
                                    util.info(trimName(socket.name) + " has relinquished control of a Dominator. Location: " + loc + " Dominator. IP: " + socket.ip + ". Players: " + clients.length + ".");
                                    socket.talk("F", ...player.records());
                                    player.body.relinquish(player);
                                }
                            } else if (c.serverName.includes("Mothership")) {
                                if (!body.underControl) {
                                    let choices = [];
                                    for (let o of entities)
                                        if (o.isMothership && o.team === player.body.team && !o.underControl) choices.push(o);
                                    if (!choices.length) return player.body.sendMessage("Your team's Mothership is unavailable for control.");
                                    let mothership = choices[Math.floor(Math.random() * choices.length)],
                                        name = body.name;
                                    mothership.underControl = true;
                                    player.body = mothership;
                                    body.controllers = [];
                                    body.passive = false;
                                    setTimeout(() => {
                                        if (body != null) {
                                            body.miscIdentifier = "No Death Log";
                                            body.kill();
                                        }
                                    }, 1000);
                                    player.body.settings.leaderboardable = false;
                                    player.body.name = name;
                                    player.body.nameColor = ["#00B0E1", "#F04F54", "#00E06C", "#BE7FF5", "#FFEB8E", "#F37C20", "#E85DDF", "#8EFFFB"][player.team - 1];
                                    player.body.sendMessage = content => socket.talk("m", content);
                                    player.body.controllers = [new io_listenToPlayer(player.body, player)];
                                    player.body.refreshFOV();
                                    player.body.invuln = player.body.godmode = player.body.passive = false;
                                    player.body.facingType = "toTarget";
                                    player.body.skill.points = 0;
                                    player.body.settings.leaderboardable = true;
                                    player.body.sendMessage("Press H or reload your game to relinquish control of the Mothership.");
                                    player.body.sendMessage("You are now controlling your team's Mothership!");
                                } else {
                                    player.body.sendMessage("You have relinquished control of your team's Mothership.");
                                    util.info(trimName(socket.name) + " has relinquished control of their team's Mothership. IP: " + socket.ip + ". Players: " + clients.length + ".");
                                    socket.talk("F", ...player.records());
                                    player.body.relinquish(player);
                                }
                            }
                        }
                        break;
                    case "L": // Level up cheat
                        {
                            if (m.length !== 0) {
                                socket.error("level up", "Ill-sized level-up request", true);
                                return 1;
                            }
                            if (body != null && !body.underControl && body.skill.level < c.SKILL_CHEAT_CAP) {
                                body.skill.score += body.skill.levelScore;
                                body.skill.maintain();
                                body.refreshBodyAttributes();
                            }
                        }
                        break;
                    case "P": // Class tree prompt
                        {
                            if (m.length !== 1) {
                                socket.error("class tree prompting", "Ill-sized class tree prompt request", true);
                                return 1;
                            }
                            if (!isAlive) return;
                            if (m[0]) {
                                body.sendMessage("Press U to close the class tree.");
                                body.sendMessage("Use the arrow keys to cycle through the class tree.");
                            }
                        }
                        break;
                    case "T": // Beta-tester level 1 and 2 keys
                        {
                            if (m.length !== 1) {
                                socket.error("beta-tester level 1-2 key", "Ill-sized key request", true);
                                return 1;
                            }
                            if (typeof m[0] !== "number") {
                                socket.error("beta-tester level 1-2 key", "Non-numeric key value", true);
                                return 1;
                            }
                            if (!isAlive || (!BETA_TOKENS_1.includes(socket.key) && !BETA_TOKENS_2.includes(socket.key) && !BETA_TOKENS_3.includes(socket.key))) return;
                            if (body.underControl) return body.sendMessage("You cannot use beta-tester keys while controlling a Dominator or Mothership.");
                            switch (m[0]) {
                                case 0: // Upgrade to TESTBED
                                    {
                                        body.define(Class.genericTank);
                                        body.define(Class.basic);
                                        if (BETA_TOKENS_1.includes(socket.key)) body.upgradeTank(Class.testbed_level_1);
                                        if (BETA_TOKENS_2.includes(socket.key)) body.upgradeTank(defsPrefix === "_test" ? Class.testbed : Class.testbed_level_2);
                                        if (BETA_TOKENS_3.includes(socket.key)) {
                                            body.upgradeTank(Class.testbed);
                                            body.health.amount = body.health.max;
                                            body.shield.amount = body.shield.max;
                                        } else body.sendMessage("DO NOT use OP tanks to repeatedly kill players. It will result in a permanent demotion. Press P to change to Basic and K to suicide.");
                                        if (room.gameMode === "ffa") body.color = "FFA_RED";
                                        else body.color = [10, 12, 11, 15, 3, 35, 36, 0][player.team - 1];
                                        util.info(trimName(body.name) + " upgraded to TESTBED. Token: " + socket.key + ". IP: " + socket.ip + ".");
                                    }
                                    break;
                                case 1: // Suicide
                                    {
                                        body.killedByK = true;
                                        body.kill();
                                        util.info(trimName(body.name) + " used k to suicide. Token: " + socket.key + ". IP: " + socket.ip + ".");
                                    }
                                    break;
                                case 2: // Reset to Basic
                                    {
                                        body.define(Class.genericTank);
                                        body.upgradeTank(Class.basic);
                                        if (BETA_TOKENS_3.includes(socket.key)) {
                                            body.health.amount = body.health.max;
                                            body.shield.amount = body.shield.max;
                                            body.invuln = true;
                                        }
                                        if (room.gameMode === "ffa") body.color = "FFA_RED";
                                        else body.color = [10, 12, 11, 15, 3, 35, 36, 0][player.team - 1];
                                    }
                                    break;
                                /*case 3: // Blank
                                    break;*/
                                case 4: // Passive mode
                                    {
                                        if (room.arenaClosed) return body.sendMessage("Passive Mode is disabled when the arena is closed.");
                                        if (BETA_TOKENS_1.includes(socket.key) && defsPrefix !== "_test") return body.sendMessage("You can only use Passive Mode in the Developer Server.");
                                        body.passive = !body.passive;
                                        for (let o of entities)
                                            if (o.master.id === body.id && o.id !== body.id) o.passive = body.passive;
                                        if (body.multibox.enabled)
                                            for (let o of body.multibox.controlledTanks) {
                                                if (o != null) o.passive = body.passive;
                                                for (let r of entities)
                                                    if (r.master.id === o.id && r.id !== o.id) r.passive = o.passive;
                                            }
                                        body.sendMessage("Passive Mode: " + (body.passive ? "ON" : "OFF"));
                                    }
                                    break;
                                case 5: // Rainbow
                                    {
                                        body.toggleRainbow();
                                        body.sendMessage("Rainbow Mode: " + (body.rainbow ? "ON" : "OFF"));
                                    }
                                    break;
                                default:
                                    socket.error("beta-tester level 1 key", `Unknown key value (${m[0]})`, true);
                                    return 1;
                            }
                        }
                        break;
                    case "B": // Beta-tester level 3 keys
                        {
                            if (m.length !== 1) {
                                socket.error("beta-tester level 3 key", "Ill-sized key request!", true);
                                return 1;
                            }
                            if (typeof m[0] !== "number") {
                                socket.error("beta-tester level 3 key", "Non-numeric key value", true);
                                return 1;
                            }
                            if (!isAlive || !BETA_TOKENS_3.includes(socket.key)) return;
                            if (body.underControl) return body.sendMessage("You cannot use beta-tester keys while controlling a Dominator or Mothership.");
                            switch (m[0]) {
                                case 0: // Color change
                                    {
                                        body.color = Math.floor(42 * Math.random());
                                    }
                                    break;
                                case 1: // Godmode
                                    {
                                        if (room.arenaClosed) return body.sendMessage("Godmode is disabled when the arena is closed.");
                                        body.godmode = !body.godmode;
                                        for (let o of entities)
                                            if (o.master.id === body.id && o.id !== body.id) o.diesToTeamBase = !body.godmode;
                                        body.sendMessage("Godmode: " + (body.godmode ? "ON" : "OFF"));
                                    }
                                    break;
                                case 2: // Spawn entities at mouse
                                    {
                                        let loc = {
                                            x: player.target.x + body.x,
                                            y: player.target.y + body.y
                                        };
                                        if (body.keyFEntity === "bot") spawnBot(loc);
                                        else {
                                            let o = new Entity(loc);
                                            o.define(Class[body.keyFEntity]);
                                            o.team = -100;
                                            if (o.type === "food") o.ACCELERATION = .015 / (o.foodLevel + 1);
                                        }
                                    }
                                    break;
                                case 3: // Teleport to mouse
                                    {
                                        body.x = player.target.x + body.x;
                                        body.y = player.target.y + body.y;
                                    }
                                    break;
                                case 7: // Reset color
                                    {
                                        if (room.gameMode === "ffa") body.color = "FFA_RED";
                                        else body.color = [10, 12, 11, 15, 3, 35, 36, 0][player.team - 1];
                                        //body.sendMessage("Reset your body color.");
                                    }
                                    break;
                                case 8: // Tank journey
                                    {
                                        body.upgradeTank(tankList[body.index + 1]);
                                    }
                                    break;
                                case 9: // Kill what your mouse is over
                                    {
                                        for (let o of entities)
                                            if (o !== body && util.getDistance(o, {x: player.target.x + body.x, y: player.target.y + body.y}) < o.size * 1.15) {
                                                if (o.settings.givesKillMessage) {
                                                    if (o.type === "tank") body.sendMessage(`You killed ${o.name || "An unnamed player"}'s ${o.label}.`);
                                                    else body.sendMessage(`You killed ${util.addArticle(o.label)}.`);
                                                }
                                                o.kill();
                                            }
                                    }
                                    break;
                                case 10: // Stealth mode
                                    {
                                        body.stealthMode = !body.stealthMode;
                                        body.settings.leaderboardable = !body.stealthMode;
                                        body.settings.givesKillMessage = !body.stealthMode;
                                        body.alpha = body.ALPHA = body.stealthMode ? 0 : tankList[body.index].ALPHA;
                                        body.sendMessage("Stealth Mode: " + (body.stealthMode ? "ON" : "OFF"));
                                    }
                                    break;
                                default:
                                    socket.error("beta-tester level 2 key", `Unknown key value (${m[0]})`, true);
                                    return 1;
                            }
                        }
                        break;
                    case "D": // Beta-tester commands
                        {
                            if (m.length < 0 || m.length > 11) {
                                socket.error("beta-tester console", "Ill-sized beta-command request", true);
                                return 1;
                            }
                            if (typeof m[0] !== "number") {
                                socket.error("beta-tester console", "Non-numeric beta-command value", true);
                                return 1;
                            }
                            if (!BETA_TOKENS_3.includes(socket.key)) return socket.talk("Z", "[ERROR] You need a beta-tester level 3 token to use these commands.");
                            if (!isAlive) return socket.talk("Z", "[ERROR] You cannot use a beta-tester command while dead.");
                            if (body.underControl) return socket.talk("Z", "[ERROR] You cannot use a beta-tester command while controlling a Dominator or Mothership.");
                            switch (m[0]) {
                                case 0: // Broadcast
                                    {
                                        sockets.broadcast(m[1], m[2]);
                                    }
                                    break;
                                case 1: // Color change
                                    {
                                        body.color = m[1];
                                    }
                                    break;
                                case 2: // Set skill points
                                    {
                                        body.skill.points = m[1];
                                    }
                                    break;
                                case 3: // Set score
                                    {
                                        body.skill.score = m[1];
                                    }
                                    break;
                                case 4: // Set size
                                    {
                                        body.SIZE = m[1];
                                    }
                                    break;
                                case 5: // Define tank
                                    {
                                        body.upgradeTank(isNaN(m[1]) ? Class[m[1]] : tankList[m[1]]);
                                    }
                                    break;
                                case 6: // Set stats
                                    {
                                        if ("weapon_speed" === m[1]) body.skill.spd = m[2];
                                        if ("weapon_reload" === m[1]) body.skill.rld = m[2];
                                        if ("move_speed" === m[1]) {
                                            body.SPEED = m[2];
                                            body.ACCELERATION = m[2] / 3;
                                            body.refreshBodyAttributes();
                                        }
                                        if ("max_health" === m[1]) {
                                            body.HEALTH = m[2];
                                            body.refreshBodyAttributes();
                                        }
                                        if ("body_damage" === m[1]) {
                                            body.DAMAGE = m[2];
                                            body.refreshBodyAttributes();
                                        }
                                        if ("weapon_damage" === m[1]) body.skill.dam = m[2];
                                    }
                                    break;
                                case 7: // Spawn entities
                                    {
                                        let o = new Entity({
                                            x: m[2] === "me" ? body.x : m[2],
                                            y: m[3] === "me" ? body.y : m[3]
                                        });
                                        o.define(Class[m[1]]);
                                        o.team = m[4] === "me" ? body.team : m[4];
                                        o.color = m[5] === "default" ? o.color : m[5];
                                        o.SIZE = m[6] === "default" ? o.SIZE : m[6];
                                        o.skill.score = m[7] === "default" ? o.skill.score : m[7];
                                        if (o.type === "food") o.ACCELERATION = .015 / (o.foodLevel + 1);
                                    }
                                    break;
                                case 8: // Change maxChildren value
                                    {
                                        body.maxChildren = m[1];
                                    }
                                    break;
                                case 9: // Teleport
                                    {
                                        body.x = m[1];
                                        body.y = m[2];
                                    }
                                    break;
                                case 10:
                                    {
                                        body.invisible = [m[1], m[2], m[3]];
                                    }
                                    break;
                                case 11: // Set FOV
                                    {
                                        body.FOV = m[1];
                                        body.refreshFOV();
                                    }
                                    break;
                                case 12: // Set autospin speed
                                    {
                                        body.spinSpeed = m[1];
                                    }
                                    break;
                                case 13: // Set entity spawned by F
                                    {
                                        body.keyFEntity = m[1];
                                    }
                                    break;
                                case 14: // Clear children
                                    {
                                        for (let o of entities)
                                            if (o.master.id === body.id && o.id !== body.id) o.kill();
                                        //body.children
                                    }
                                    break;
                                case 15: // Set team
                                    {
                                        if (-m[1] > room.teamAmount) return socket.talk("Z", "[ERROR] The maximum team amount for this server is " + room.teamAmount + ".");
                                        body.team = m[1];
                                        player.team = -m[1];
                                    }
                                    break;
                                case 17: // Change skill-set
                                    {
                                        body.skill.set([m[7], m[5], m[4], m[6], m[3], m[10], m[1], m[2], m[9], m[8]]);
                                        body.skill.points -= m[1] + m[2] + m[3] + m[4] + m[5] + m[6] + m[7] + m[8] + m[9] + m[10];
                                        if (body.skill.points < 0) body.skill.points = 0;
                                        body.refreshBodyAttributes();
                                    }
                                    break;
                                case 18: // Set rainbow speed
                                    {
                                        body.rainbowSpeed = m[1];
                                        body.toggleRainbow();
                                        body.toggleRainbow();
                                    }
                                    break;
                                case 19: // Enable or disable multiboxing
                                    {
                                        if (m[1] === 0) {
                                            if (!body.multibox.enabled) return socket.talk("Z", "[ERROR] Multiboxing is already disabled for you.");
                                            socket.talk("Z", "[INFO] You have disabled multiboxing for yourself.");
                                            body.multibox.enabled = false;
                                            body.onDead();
                                            return body.onDead = null;
                                        }
                                        socket.talk("Z", "[INFO] You are now controlling " + m[1] + " new " + (m[1] > 1 ? "entities" : "entity") + ".");
                                        while (m[1]-- > 0) {
                                            let controlledBody = new Entity({
                                                x: body.x + Math.random() * 5,
                                                y: body.y - Math.random() * 5
                                            });
                                            if (room.gameMode === "tdm") controlledBody.team = body.team;
                                            else body.team = controlledBody.team = -9;
                                            controlledBody.define(Class.basic);
                                            controlledBody.controllers = [new io_listenToPlayer(body, player)];
                                            controlledBody.invuln = false;
                                            controlledBody.color = body.color;
                                            controlledBody.settings.leaderboardable = false;
                                            controlledBody.passive = body.passive;
                                            controlledBody.godmode = body.godmode;
                                            if (body.stealthMode) controlledBody.alpha = controlledBody.ALPHA = 0;
                                            body.multibox.controlledTanks.push(controlledBody);
                                        }
                                        body.onDead = () => {
                                            if (body.multibox.intervalID != null) clearInterval(body.multibox.intervalID);
                                            for (let o of body.multibox.controlledTanks)
                                                if (o.isAlive()) o.kill();
                                            body.multibox.controlledTanks = [];
                                        };
                                        if (!body.multibox.enabled) body.toggleMultibox();
                                        body.multibox.enabled = true;
                                    }
                                    break;
                                default:
                                    socket.error("beta-tester console", `Unknown beta-command value (${m[1]})`, true);
                                    return 1;
                            }
                        }
                        break;
                    case "X": // Boss tiers
                        {
                            if (m.length !== 0) {
                                socket.error("tier cycle", "Ill-sized tier cycle request", true);
                                return 1;
                            }
                            if (!isAlive || body.bossTierType === -1 || !body.canUseQ) return;
                            body.canUseQ = false;
                            setTimeout(() => body.canUseQ = true, 1000);
                            let labelMap = (new Map()
                                .set("MK-1", 1).set("MK-2", 2).set("MK-3", 3).set("MK-4", 4).set("MK-5", 0)
                                .set("TK-1", 1).set("TK-2", 2).set("TK-3", 3).set("TK-4", 4).set("TK-5", 0)
                                .set("PK-1", 1).set("PK-2", 2).set("PK-3", 3).set("PK-4", 0)
                                .set("EK-1", 1).set("EK-2", 2).set("EK-3", 3).set("EK-4", 4).set("EK-5", 5).set("EK-6", 0)
                                .set("HK-1", 1).set("HK-2", 2).set("HK-3", 3).set("HK-4", 0)
                                .set("HPK-1", 1).set("HPK-2", 2).set("HPK-3", 0)
                                .set("RK-1", 1).set("RK-2", 2).set("RK-3", 3).set("RK-4", 4).set("RK-5", 0)
                                .set("OBP-1", 1).set("OBP-2", 2).set("OBP-3", 0)
                                .set("AWP-1", 1).set("AWP-2", 2).set("AWP-3", 3).set("AWP-4", 4).set("AWP-5", 5).set("AWP-6", 6).set("AWP-7", 7).set("AWP-8", 8)
                                .set("AWP-9", 9).set("AWP-10", 0)
                                .set("Defender", 1).set("Custodian", 0)
                                .set("Switcheroo (Ba)", 1).set("Switcheroo (Tw)", 2).set("Switcheroo (Sn)", 3).set("Switcheroo (Ma)", 4).set("Switcheroo (Fl)", 5)
                                .set("Switcheroo (Di)", 6).set("Switcheroo (Po)", 7).set("Switcheroo (Pe)", 8).set("Switcheroo (Tr)", 9).set("Switcheroo (Pr)", 10)
                                .set("Switcheroo (Au)", 11).set("Switcheroo (Mi)", 12).set("Switcheroo (La)", 13).set("Switcheroo (A-B)", 14).set("Switcheroo (Si)", 15)
                                .set("Switcheroo (Hy)", 16).set("Switcheroo (Su)", 17).set("Switcheroo (Mg)", 0)
                                .set("CHK-1", 1).set("CHK-2", 2).set("CHK-3", 0)
                                .set("GK-1", 1).set("GK-2", 2).set("GK-3", 0)
                                .set("NK-1", 1).set("NK-2", 2).set("NK-3", 3).set("NK-4", 4).set("NK-5", 5).set("NK-5", 0)
                                .set("Dispositioner", 1).set("Reflector", 2).set("Triad", 0)
                                .set("SOULLESS-1", 1)
                                .set("Railtwin", 1).set("Synced Railtwin", 0)
                            );
                            if (labelMap.has(body.label) && body.bossTierType !== 16) body.tierCounter = labelMap.get(body.label);
                            switch (body.bossTierType) {
                                case 0:
                                    body.upgradeTank(Class[`eggBossTier${++body.tierCounter}`]);
                                    break;
                                case 1:
                                    body.upgradeTank(Class[`squareBossTier${++body.tierCounter}`]);
                                    break;
                                case 2:
                                    body.upgradeTank(Class[`triangleBossTier${++body.tierCounter}`]);
                                    break;
                                case 3:
                                    body.upgradeTank(Class[`pentagonBossTier${++body.tierCounter}`]);
                                    break;
                                case 4:
                                    body.upgradeTank(Class[`hexagonBossTier${++body.tierCounter}`]);
                                    break;
                                case 5:
                                    body.upgradeTank(Class[`heptagonBossTier${++body.tierCounter}`]);
                                    break;
                                case 6:
                                    body.upgradeTank(Class[`rocketBossTier${++body.tierCounter}`]);
                                    break;
                                case 7:
                                    body.upgradeTank(Class[`obp${++body.tierCounter}`]);
                                    break;
                                case 8:
                                    body.upgradeTank(Class[`AWP_${++body.tierCounter}`]);
                                    break;
                                case 9:
                                    body.upgradeTank(Class[`defender${++body.tierCounter}`]);
                                    break;
                                case 10:
                                    body.upgradeTank(Class[`switcheroo${++body.tierCounter}`]);
                                    break;
                                case 11:
                                    body.upgradeTank(Class[`chk${++body.tierCounter}`]);
                                    break;
                                case 12:
                                    body.upgradeTank(Class[`greenBossTier${++body.tierCounter}`]);
                                    break;
                                case 13:
                                    body.upgradeTank(Class[`nk${++body.tierCounter}`]);
                                    break;
                                case 14:
                                    body.upgradeTank(Class[`hewnPuntUpg${++body.tierCounter}`]);
                                    break;
                                case 15:
                                    body.upgradeTank(Class[`soulless${++body.tierCounter}`]);
                                    break;
                                case 16:
                                    for (let o of entities)
                                        if (o.master.id === body.id && o.type === "drone") o.kill();
                                    let increment = 20 * body.switcherooID;
                                    for (let i = 1; i < 21; i++) setTimeout(() => {
                                        if (body.isAlive()) body.master.define(Class[`switcherooAnim${i + increment === 380 ? 0 : i + increment}`]);
                                    }, 24 * i);
                                    if (body.multibox.enabled)
                                        for (let o of body.multibox.controlledTanks)
                                            if (o.isAlive()) {
                                                for (let r of entities)
                                                    if (r.master.id === o.id && r.type === "drone") r.kill();
                                                for (let i = 1; i < 21; i++) setTimeout(() => {
                                                    if (o.isAlive()) {
                                                        let num = i + increment === 380 ? 0 : i + increment;
                                                        o.master.define(Class[`switcherooAnim${num}`]);
                                                        body.tank = `switcherooAnim${num}`;
                                                    }
                                                }, 24 * i);
                                            }
                                    break;
                                case 17:
                                    body.upgradeTank(Class[`twinRailgun${++body.tierCounter}`]);
                                    break;
                                default:
                                    socket.error("tier cycle", `Unknown Q tier value (${body.bossTierType})`, true);
                                    return 1;
                            }
                        }
                        break;
                    case "M": // Sync name color
                        if (!isAlive) return;
                        for (let i = 0; i < BETA_TOKENS_1.length; i++)
                            if (BETA_TOKENS_1[i] === socket.key) body.nameColor = BETA_COLORS_1[i] || "#FFFFFF";
                        for (let i = 0; i < BETA_TOKENS_2.length; i++)
                            if (BETA_TOKENS_2[i] === socket.key) body.nameColor = BETA_COLORS_2[i] || "#FFFFFF";
                        for (let i = 0; i < BETA_TOKENS_3.length; i++)
                            if (BETA_TOKENS_3[i] === socket.key) body.nameColor = BETA_COLORS_3[i] || "#FFFFFF";
                        if (socket.name === "4NAX") body.nameColor = "#FF9999";
                        if (socket.name === "Silvy") body.nameColor = "#99F6FF";
                        break;
                    default:
                        socket.error("initialization", `Unknown packet index (${index})`, true);
                        return 1;
                }
            };
            const traffic = socket => {
                let strikes = 0;
                return () => {
                    if (util.time() - socket.status.lastHeartbeat > c.maxHeartbeatInterval) {
                        socket.error("traffic evaluation", "Heartbeat lost", true);
                        return 0;
                    }
                    if (socket.status.requests > 50) strikes++;
                    else strikes = 0;
                    if (strikes > 3) {
                        socket.error("traffic evaluation", "Socket traffic volume violation", true);
                        return 0;
                    }
                    socket.status.requests = 0;
                };
            };
            const spawn = (() => {
                const newgui = (() => {
                    const floppy = (value = null) => {
                        let flagged = true;
                        return {
                            update: newValue => {
                                let e = false;
                                if (value == null) e = true;
                                else {
                                    if (typeof newValue !== typeof value) e = true;
                                    switch (typeof newValue) {
                                        case "number":
                                        case "string":
                                            {
                                                if (newValue !== value) e = true;
                                            }
                                            break;
                                        case "object":
                                            {
                                                if (Array.isArray(newValue)) {
                                                    if (newValue.length !== value.length) e = true;
                                                    else for (let i = 0, len = newValue.length; i < len; i++)
                                                        if (newValue[i] !== value[i]) e = true;
                                                    break;
                                                }
                                            } // jshint ignore:line
                                        default:
                                            util.error(newValue);
                                            throw new Error("Unsupported type for a floppyvar!");
                                    }
                                }
                                if (e) {
                                    flagged = true;
                                    value = newValue;
                                }
                            },
                            publish: () => {
                                if (flagged && value != null) {
                                    flagged = false;
                                    return value;
                                }
                            }
                        };
                    }
                    const container = player => {
                        let vars = [],
                            skill = player.body.skill,
                            out = [],
                            statNames = ["atk", "hlt", "spd", "str", "pen", "dam", "rld", "mob", "rgn", "shi"];
                        for (let i = 0; i < statNames.length * 3; i++) vars.push(floppy());
                        return {
                            update: () => {
                                let needsUpdate = false,
                                    j = 0;
                                for (let a of statNames) {
                                    vars[j++].update(skill.title(a));
                                    vars[j++].update(skill.cap(a));
                                    vars[j++].update(skill.cap(a, true));
                                }
                                for (let e of vars)
                                    if (e.publish() != null) needsUpdate = true;
                                if (needsUpdate)
                                    for (let a of statNames) {
                                        out.push(skill.title(a));
                                        out.push(skill.cap(a));
                                        out.push(skill.cap(a, true));
                                    }
                            },
                            publish: () => {
                                if (out.length) {
                                    let o = out.splice(0, out.length);
                                    out = [];
                                    return o;
                                }
                            }
                        };
                    };
                    const getSkills = s => {
                        let val = 0;
                        val += 0x1 * s.amount("atk");
                        val += 0x10 * s.amount("hlt");
                        val += 0x100 * s.amount("spd");
                        val += 0x1000 * s.amount("str");
                        val += 0x10000 * s.amount("pen");
                        val += 0x100000 * s.amount("dam");
                        val += 0x1000000 * s.amount("rld");
                        val += 0x10000000 * s.amount("mob");
                        val += 0x100000000 * s.amount("rgn");
                        val += 0x1000000000 * s.amount("shi");
                        return val.toString(36);
                    };
                    const update = gui => {
                        let b = gui.master.body;
                        if (!b) return 0;
                        gui.bodyid = b.id;
                        gui.fps.update(Math.min(1, room.fps / room.speed / 1000 * 30));
                        gui.color.update(gui.master.teamColor);
                        gui.label.update(b.index);
                        gui.score.update(b.skill.score);
                        gui.points.update(b.skill.points);
                        let upgrades = [];
                        for (let e of b.upgrades)
                            if (b.skill.level >= e.level) upgrades.push(e.index + room.manualOffset);
                        gui.upgrades.update(upgrades);
                        gui.stats.update();
                        gui.skills.update(getSkills(b.skill));
                        gui.accel.update(b.acceleration);
                        gui.topspeed.update(b.topSpeed);
                    };
                    const publish = gui => {
                        let o = {
                                fps: gui.fps.publish(),
                                label: gui.label.publish(),
                                score: gui.score.publish(),
                                points: gui.points.publish(),
                                upgrades: gui.upgrades.publish(),
                                color: gui.color.publish(),
                                statsdata: gui.stats.publish(),
                                skills: gui.skills.publish(),
                                accel: gui.accel.publish(),
                                top: gui.topspeed.publish()
                            },
                            oo = [0];
                        if (o.fps != null) {
                            oo[0] += 0x0001;
                            oo.push(o.fps || 1);
                        }
                        if (o.label != null) {
                            oo[0] += 0x0002;
                            oo.push(o.label);
                            oo.push(o.color || gui.master.teamColor);
                            oo.push(gui.bodyid);
                        }
                        if (o.score != null) {
                            oo[0] += 0x0004;
                            oo.push(o.score);
                        }
                        if (o.points != null) {
                            oo[0] += 0x0008;
                            oo.push(o.points);
                        }
                        if (o.upgrades != null) {
                            oo[0] += 0x0010;
                            oo.push(o.upgrades.length, ...o.upgrades);
                        }
                        if (o.statsdata != null) {
                            oo[0] += 0x0020;
                            oo.push(...o.statsdata);
                        }
                        if (o.skills != null) {
                            oo[0] += 0x0040;
                            oo.push(o.skills);
                        }
                        if (o.accel != null) {
                            oo[0] += 0x0080;
                            oo.push(o.accel);
                        }
                        if (o.top != null) {
                            oo[0] += 0x0100;
                            oo.push(o.top);
                        }
                        return oo;
                    };
                    return player => {
                        let gui = {
                            master: player,
                            fps: floppy(),
                            label: floppy(),
                            score: floppy(),
                            points: floppy(),
                            upgrades: floppy(),
                            color: floppy(),
                            skills: floppy(),
                            topspeed: floppy(),
                            accel: floppy(),
                            stats: container(player),
                            bodyid: -1
                        };
                        return {
                            update: () => update(gui),
                            publish: () => publish(gui)
                        };
                    };
                })();
                return (socket, name) => {
                    let player = {},
                        loc = {};
                    player.team = socket.rememberedTeam;
                    switch (room.gameMode) {
                        case "tdm":
                            {
                                let census = [1, 1, 1, 1, 1, 1, 1, 1],
                                    scoreCensus = [1, 1, 1, 1, 1, 1, 1, 1];
                                for (let p of players) {
                                    census[p.team - 1]++;
                                    if (p.body != null) scoreCensus[p.team - 1] += p.body.skill.score;
                                }
                                let possiblities = [],
                                    sector = !room["bas1"].length ? "n_b" : !room["n_b1"].length ? "bas" : ran.choose(["bas", "n_b"]);
                                for (let i = 0, m = 0; i < room.teamAmount; i++) {
                                    let v = Math.round(1e6 * (room[(sector) + (i + 1)].length + 1) / (census[i] + 1) / scoreCensus[i]);
                                    if (v > m) {
                                        m = v;
                                        possiblities = [i];
                                    }
                                    if (v === m) possiblities.push(i);
                                }
                                if (player.team == null) player.team = ran.choose(possiblities) + 1;
                                if (room[(sector) + player.team].length) {
                                    do loc = room.randomType(sector + player.team);
                                    while (dirtyCheck(loc, 50));
                                } else {
                                    do loc = room.gaussInverse(5);
                                    while (dirtyCheck(loc, 50));
                                }
                            }
                            break;
                        default:
                            do loc = room.gaussInverse(5);
                            while (dirtyCheck(loc, 50));
                    }
                    socket.rememberedTeam = player.team;
                    let body = new Entity(loc);
                    body.protect();
                    body.define(Class[startingTank]); // body.define(Class[[startingTank, "auto1", "watcher", "caltrop", "microshot"][ran.chooseChance(40, 20, 20, 10, 10)]]);
                    body.name = name;
                    body.addController(new io_listenToPlayer(body, player));
                    body.sendMessage = content => socket.talk("m", content);
                    if (socket.key === tokens.hellcat_2) {
                        body.stealthMode = true;
                        body.alpha = body.ALPHA = 0;
                        body.settings.givesKillMessage = body.settings.leaderboardable = false;
                        body.sendMessage("DO NOT use this token to get world record scores; stealth mode denies AI from attacking you!");
                    }
                    let invulnTime = room.gameMode !== "tdm" || !room["bas1"].length ? 18e4 : 6e4;
                    body.invuln = true;
                    setTimeout(() => body.invuln = false, invulnTime);
                    player.body = body;
                    if (room.gameMode === "tdm") {
                        body.team = -player.team;
                        body.color = [10, 12, 11, 15, 3, 35, 36, 0][player.team - 1];
                    } else body.color = "FFA_RED";
                    player.teamColor = room.gameMode === "ffa" ? 10 : body.color;
                    player.target = {
                        x: 0,
                        y: 0
                    };
                    player.command = {
                        up: false,
                        down: false,
                        left: false,
                        right: false,
                        lmb: false,
                        mmb: false,
                        rmb: false,
                        autofire: false,
                        autospin: false,
                        override: false
                    };
                    player.records = (() => {
                        let begin = util.time();
                        return () => [
                            player.body.skill.score,
                            Math.floor((util.time() - begin) / 1000),
                            player.body.killCount.solo,
                            player.body.killCount.assists,
                            player.body.killCount.bosses,
                            player.body.killCount.killers.length,
                            ...player.body.killCount.killers
                        ];
                    })();
                    player.gui = newgui(player);
                    player.socket = socket;
                    players.push(player);
                    socket.camera.x = body.x;
                    socket.camera.y = body.y;
                    socket.camera.fov = 1000;
                    socket.status.hasSpawned = true;
                    body.sendMessage(`You will remain invulnerable until you move, shoot, or wait ${invulnTime / 6e4} minute${invulnTime / 6e4 > 1 ? "s" : ""}.`);
                    body.sendMessage("You have spawned! Welcome to the game. Hold N to level up.");
                    socket.talk("c", socket.camera.x, socket.camera.y, socket.camera.fov);
                    return player;
                };
            })();
            const eyes = (() => {
                const flatten = data => {
                    let output = [data.type];
                    if (data.type & 0x01) output.push(data.facing, data.layer);
                    else {
                        output.push(
                            data.id,
                            data.index,
                            data.x,
                            data.y,
                            data.vx,
                            data.vy,
                            data.size,
                            data.facing,
                            data.vfacing,
                            data.twiggle,
                            data.layer,
                            data.color,
                            Math.ceil(255 * data.health),
                            Math.round(255 * data.shield),
                            Math.round(255 * data.alpha),
                            data.cx,
                            data.cy,
                            data.seeInvisible,
                            data.nameColor
                        );
                        if (data.type & 0x04) output.push(data.name, data.score);
                    }
                    let gunData = [data.guns.length];
                    for (let lastShot of data.guns) gunData.push(lastShot.time, lastShot.power);
                    output.push(...gunData);
                    let turretData = [data.turrets.length];
                    for (let turret of data.turrets) turretData.push(...flatten(turret));
                    output.push(...turretData);
                    return output;
                };
                const perspective = (e, player, data) => {
                    if (player.body != null && player.body.id === e.master.id) {
                        data = data.slice();
                        if (player.command.autospin) data[10] = 1;
                        if (room.gameMode === "ffa" && player.body.color === "FFA_RED") data[12] = player.teamColor;
                    }
                    return data;
                };
                const check = (camera, obj) => Math.abs(obj.x - camera.x) < camera.fov * .6 + 1.5 * obj.size + 100 && Math.abs(obj.y - camera.y) < camera.fov * .6 * .5625 + 1.5 * obj.size + 100;
                return socket => {
                    let lastVisibleUpdate = 0,
                        nearby = [],
                        x = -1000,
                        y = -1000,
                        fov = 0,
                        o = {
                            add: e => {
                                if (check(socket.camera, e)) nearby.push(e);
                            },
                            remove: e => {
                                let i = nearby.indexOf(e);
                                if (i !== -1) util.remove(nearby, i);
                            },
                            check: e => check(socket.camera, e),
                            gazeUpon: () => {
                                logs.network.set();
                                let player = socket.player,
                                    camera = socket.camera,
                                    rightNow = room.lastCycle;
                                if (rightNow === camera.lastUpdate) {
                                    socket.update(5 + room.cycleSpeed - util.time() + rightNow);
                                    return 1;
                                }
                                camera.lastUpdate = rightNow;
                                socket.status.receiving++;
                                let setFov = camera.fov;
                                if (player.body != null) {
                                    if (player.body.isDead()) {
                                        socket.status.deceased = true;
                                        socket.talk("F", ...player.records());
                                        if (player.body.miscIdentifier !== "No Death Log") util.info(trimName(player.body.name) + " has died. Final Score: " + player.body.skill.score + ". Tank Used: " + player.body.label + ". IP: " + socket.ip + ". Players: " + clients.length + ".");
                                        socket.beginTimeout();
                                        player.body = null;
                                    } else if (player.body.photo) {
                                        camera.x = player.body.photo.cx;
                                        camera.y = player.body.photo.cy;
                                        camera.vx = player.body.photo.vx;
                                        camera.vy = player.body.photo.vy;
                                        setFov = player.body.fov;
                                        player.viewId = player.body.id;
                                    }
                                } else setFov = 1000;
                                camera.fov += Math.max(.03 * (setFov - camera.fov), setFov - camera.fov);
                                x = camera.x;
                                y = camera.y;
                                fov = camera.fov;
                                if (camera.lastUpdate - lastVisibleUpdate > c.visibleListInterval) {
                                    lastVisibleUpdate = camera.lastUpdate;
                                    nearby = entities.map(e => {
                                        if (check(socket.camera, e)) return e;
                                    }).filter(e => e);
                                }
                                let visible = nearby.map(e => {
                                        if (e.photo && (Math.abs(e.x - x) < fov / 2 + 1.5 * e.size && Math.abs(e.y - y) < fov / 1.125 + 1.5 * e.size)) {
                                            if (!e.flattenedPhoto) e.flattenedPhoto = flatten(e.photo);
                                            return perspective(e, player, e.flattenedPhoto);
                                        }
                                    }).filter(e => e),
                                    numberInView = visible.length,
                                    view = [];
                                for (let e of visible) view.push(...e);
                                player.gui.update();
                                socket.talk(
                                    "u",
                                    rightNow,
                                    camera.x,
                                    camera.y,
                                    setFov,
                                    camera.vx,
                                    camera.vy,
                                    ...player.gui.publish(),
                                    numberInView,
                                    ...view
                                );
                                if (socket.status.receiving < c.networkFrontlog) socket.update(Math.max(
                                    0,
                                    room.networkSpeed - (camera.lastDowndate - camera.lastUpdate),
                                    camera.ping / c.networkFrontlog
                                ));
                                else socket.update(36);
                                logs.network.mark();
                            }
                        };
                    views.push(o);
                    return o;
                };
            })();
            const broadcast = (() => {
                let readMap,
                    readLB;
                const getMinimap = (() => {
                    const cleanMapReader = (() => {
                        const flattener = () => {
                            let internalMap = [];
                            const flatten = data => {
                                if (data == null) data = [];
                                let out = [data.length];
                                for (let d of data) out.push(...d);
                                return out;
                            }
                            const challenge = (value, challenger) => value[1] === challenger[0] && value[2] === challenger[1] && value[3] === challenger[2];
                            return {
                                update: data => {
                                    for (let e of internalMap) e[0] = -1;
                                    data = data.map(d => [
                                        Math.round(255 * util.clamp(d[0] / room.width, 0, 1)),
                                        Math.round(255 * util.clamp(d[1] / room.height, 0, 1)),
                                        d[2]
                                    ]);
                                    for (let d of data) {
                                        let j = internalMap.findIndex(e => challenge(e, d));
                                        if (j === -1) internalMap.push([1, ...d]);
                                        else internalMap[j][0] = 0;
                                    }
                                    let ex = internalMap.filter(e => e[0] !== 0);
                                    internalMap = internalMap.filter(e => e[0] !== -1);
                                    let f = flatten(ex);
                                    return f;
                                },
                                exportAll: () => flatten(internalMap.map(e => [1, e[1], e[2], e[3]]))
                            };
                        };
                        return room.gameMode === "ffa" ? (() => {
                            let publicMap = flattener();
                            return () => {
                                let clean = publicMap.update(minimap.map(entry => [entry[1], entry[2], entry[6] === "appearOnMinimap" || entry[4] === "miniboss" ? entry[3] : entry[4] === "mazeWall" ? 16 : entry[4] === "wall" ? 18 : 17])),
                                    full = publicMap.exportAll();
                                return (team, everything = false) => everything ? full : clean;
                            };
                        })() : (() => {
                            let teamMap = [];
                            for (let i = 0; i < room.teamAmount; i++) teamMap.push(flattener());
                            return () => {
                                let clean = [],
                                    full = [];
                                for (let i = 1; i < room.teamAmount + 1; i++) {
                                    clean.push(teamMap[i - 1].update(minimap.map(entry => [entry[1], entry[2], entry[6] === "appearOnMinimap" || entry[4] === "miniboss" || (entry[4] === "tank" && entry[5] === -i) ? entry[3] : entry[4] === "mazeWall" ? 16 : entry[4] === "wall" ? 18 : 17])));
                                    full.push(teamMap[i - 1].exportAll());
                                }
                                return (team, everything = false) => everything ? full[team - 1] : clean[team - 1];
                            };
                        })();
                    })();
                    return () => {
                        for (let my of entities)
                            if (my.settings.drawShape && ran.dice(my.stealth * c.STEALTH)) {
                                let i = minimap.findIndex(entry => entry[0] === my.id);
                                if (i !== -1) minimap[i] = [my.id, my.x, my.y, my.color, my.type, my.team, my.miscIdentifier];
                                else minimap.push([my.id, my.x, my.y, my.color, my.type, my.team, my.miscIdentifier]);
                            }
                        return cleanMapReader();
                    };
                })();
                const getLeaderboard = (() => {
                    let lb = {
                            full: [],
                            updates: []
                        },
                        list = new PriorityQueue();
                    const listify = instance => {
                        if (instance.settings.leaderboardable && instance.settings.drawShape && (instance.type === "tank" || instance.killCount.solo || instance.killCount.assists)) list.enqueue(1 / (instance.skill.score + 1), instance);
                    };
                    const flatten = (() => {
                        let leaderboard = {};
                        const indices = (() => {
                            let data = [],
                                removed = [];
                            return {
                                flag: () => {
                                    for (let index of data) index.status = -1;
                                    if (data == null) data = [];
                                },
                                cull: () => {
                                    removed = [];
                                    data = data.filter(index => {
                                        let d = index.status === -1;
                                        if (d) removed.push(index.id);
                                        return !d;
                                    });
                                    return removed;
                                },
                                add: id => {
                                    data.push({
                                        id: id,
                                        status: 1
                                    });
                                },
                                stabilize: id => {
                                    data[data.findIndex(index => index.id === id)].status = 0;
                                }
                            };
                        })();
                        const process = (() => {
                            const barColor = entry => {
                                switch (entry.team) {
                                    case -100:
                                        return entry.color;
                                    case -1:
                                        return 10;
                                    case -2:
                                        return 12;
                                    case -3:
                                        return 11;
                                    case -4:
                                        return 15;
                                    case -5:
                                        return 3;
                                    case -6:
                                        return 35;
                                    case -7:
                                        return 36;
                                    case -8:
                                        return 0;
                                    default:
                                        if (room.gameMode === "tdm") return entry.color;
                                        else if (entry.name.includes("Trans Rights")) return 211;
                                        else return 11; // FFA_RED?
                                }
                            };
                            const getFull = entry => ([
                                -entry.id,
                                Math.round(entry.skill.score),
                                entry.index,
                                entry.name,
                                entry.color,
                                barColor(entry),
                                entry.nameColor
                            ]);
                            return {
                                normal: entry => {
                                    let id = entry.id,
                                        score = Math.round(entry.skill.score),
                                        lb = leaderboard["_" + id];
                                    if (lb != null) {
                                        indices.stabilize(id);
                                        if (lb.score !== score || lb.index !== entry.index) {
                                            lb.score = score;
                                            lb.index = entry.index;
                                            return [
                                                id,
                                                score,
                                                entry.index
                                            ];
                                        }
                                    } else {
                                        indices.add(id);
                                        leaderboard["_" + id] = {
                                            score: score,
                                            name: entry.name,
                                            index: entry.index,
                                            color: entry.color,
                                            bar: barColor(entry),
                                            nameColor: entry.nameColor
                                        };
                                        return getFull(entry);
                                    }
                                },
                                full: entry => getFull(entry)
                            };
                        })();
                        return data => {
                            indices.flag();
                            let orders = data.map(process.normal).filter(e => e),
                                refresh = data.map(process.full).filter(e => e),
                                flatOrders = [],
                                flatRefresh = [];
                            for (let e of orders) flatOrders.push(...e);
                            for (let e of refresh) flatRefresh.push(...e);
                            let removed = indices.cull();
                            for (let id of removed) delete leaderboard["_" + id];
                            return {
                                updates: [removed.length, ...removed, orders.length, ...flatOrders],
                                full: [-1, refresh.length, ...flatRefresh]
                            };
                        };
                    })();
                    return () => {
                        list.clear();
                        for (let e of entities) listify(e);
                        let topTen = [];
                        for (let i = 0; i < 10; i++) {
                            if (list.getCount()) topTen.push(list.dequeue());
                            else break;
                        }
                        topTen = topTen.filter(e => e);
                        room.topPlayerID = topTen.length ? topTen[0].id : -1;
                        lb = flatten(topTen);
                        return (full = false) => full ? lb.full : lb.updates;
                    };
                })();
                const slowLoop = () => {
                    logs.minimap.set();
                    readMap = getMinimap();
                    readLB = getLeaderboard();
                    logs.minimap.mark();
                    let time = util.time();
                    for (let socket of clients)
                        if (time - socket.statuslastHeartbeat > c.maxHeartbeatInterval) socket.kick("Lost heartbeat!");
                };
                setInterval(slowLoop, 1000);
                return socket => {
                    if (socket.status.hasSpawned) {
                        let m = [0],
                            lb = [0, 0];
                        m = readMap(socket.player.team, socket.status.needsFullMap);
                        socket.status.needsFullMap = false;
                        lb = readLB(socket.status.needsFullLeaderboard);
                        socket.status.needsFullLeaderboard = false;
                        if (m !== [0] || lb !== [0, 0]) socket.talk("b", ...m, ...lb);
                    }
                };
            })();
            return (socket, req) => {
                socket.talk = (...message) => {
                    if (socket.readyState === socket.OPEN) socket.send(protocol.encode(message), {
                        binary: true
                    });
                };
                if (c.servesStatic || req.connection.remoteAddress === "::ffff:127.0.0.1" || req.connection.remoteAddress === "::ffff:81.64.140.78" || req.connection.remoteAddress === "::ffff:177.239.82.139" || req.connection.remoteAddress === "::ffff:66.214.94.56" || req.connection.remoteAddress === "::1") {
                    socket.ip = req.connection.remoteAddress;
                    let index = bannedIPs[0].indexOf(socket.ip);
                    if (index !== -1) {
                        socket.talk("P", "You have been banned from the server. Reason: " + bannedIPs[1][index]);
                        util.warn("A banned IP tried to connect: " + socket.ip + "! Player has been disconnected.");
                        socket.terminate();
                        return 1;
                    }
                    //if (!c.servesStatic) {
                    let n = connectedIPs.findIndex(w => w.ip === socket.ip);
                    if (n !== -1) {
                        if (connectedIPs[n].number > c.playerTabLimit - 1) {
                            socket.talk("P", "Too many connections from this IP have been detected. Please close some tabs and try again.");
                            util.warn("Too many connections from the same IP: " + socket.ip + "! Player has been disconnected.");
                            socket.terminate();
                            return 1;
                        } else connectedIPs[n].number++;
                    } else connectedIPs.push({
                        ip: socket.ip,
                        number: 1
                    });
                } else {
                    socket.terminate();
                    return 1;
                }
                socket.binaryType = "arraybuffer";
                socket.key = "";
                socket.player = {
                    camera: {}
                };
                socket.status = {
                    verified: false,
                    receiving: 0,
                    deceased: true,
                    requests: 0,
                    hasSpawned: false,
                    needsFullMap: true,
                    needsFullLeaderboard: true,
                    lastHeartbeat: util.time()
                };
                socket.loops = (() => {
                    let nextUpdateCall = null,
                        trafficMonitoring = setInterval(() => traffic(socket), 1500),
                        broadcastingGuiStuff = setInterval(() => broadcast(socket), 1000);
                    return {
                        setUpdate: timeout => {
                            nextUpdateCall = timeout;
                        },
                        cancelUpdate: () => {
                            clearTimeout(nextUpdateCall);
                        },
                        terminate: () => {
                            clearTimeout(nextUpdateCall);
                            clearTimeout(trafficMonitoring);
                            clearTimeout(broadcastingGuiStuff);
                        }
                    };
                })();
                socket.camera = {
                    x: undefined,
                    y: undefined,
                    vx: 0,
                    vy: 0,
                    lastUpdate: util.time(),
                    lastDowndate: undefined,
                    fov: 2000
                };
                socket.makeView = () => {
                    socket.view = eyes(socket);
                };
                socket.makeView();
                socket.ban = (reason, secondaryReason) => ban(socket, reason, secondaryReason);
                socket.kick = reason => kick(socket, reason);
                socket.error = (type, reason, report) => error(socket, type, reason, report);
                socket.lastWords = (...message) => {
                    if (socket.readyState === socket.OPEN) socket.send(protocol.encode(message), {
                        binary: true
                    }, () => setTimeout(() => socket.terminate(), 1000));
                };
                socket.on("message", message => incoming(message, socket));
                socket.on("close", () => {
                    socket.loops.terminate();
                    close(socket);
                });
                socket.on("error", e => {
                    util.error("" + e);
                });
                socket.spawn = name => spawn(socket, name);
                socket.spawnCount = 0;
                socket.name = "undefined";
                socket.update = time => {
                    socket.loops.cancelUpdate();
                    socket.loops.setUpdate(setTimeout(() => {
                        socket.view.gazeUpon();
                    }, time));
                };
                socket.inactivityTimeout = null;
                socket.beginTimeout = () => {
                    socket.inactivityTimeout = setTimeout(() => {
                        socket.talk("P", "You were disconnected for inactivity.");
                        socket.kick("Kicked for inactivity!");
                    }, c.INACTIVITY_TIMEOUT * 1000);
                };
                socket.endTimeout = () => clearTimeout(socket.inactivityTimeout);
                clients.push(socket);
            };
        })()
    };
})();
const gameLoop = (() => {
    const collide = (() => {
        return collision => {
            let instance = collision[0],
                other = collision[1];
            if (instance.isGhost || other.isGhost) {
                let ghost = instance.isGhost ? instance : other;
                if (ghost.settings.hitsOwnType !== "shield") {
                    util.error("A ghost has been found!");
                    util.error("Type: " + ghost.label);
                    util.error("Position: (" + ghost.x + ", " + ghost.y + ")");
                    util.error("Collision Array: " + ghost.collisionArray);
                    util.error("Health: " + ghost.health.amount);
                    util.error("Ghost removed successfully.");
                }
                if (grid.checkIfInHSHG(ghost)) grid.removeObject(ghost);
                ghost.isInGrid = false;
                return 0;
            }
            if (!instance.activation.check() && !other.activation.check()) {
                util.warn("Tried to collide with an inactive instance!");
                return 0;
            }
            // No Collision (Forced)
            else if (instance.settings.hitsOwnType === "forcedNever" || other.settings.hitsOwnType === "forcedNever") return;
            // Collision Functions
            const simpleCollide = (my, n) => {
                let diff = (1 + util.getDistance(my, n) / 2) * room.speed,
                    a = my.intangibility ? 1 : my.pushability,
                    b = n.intangibility ? 1 : n.pushability,
                    _c = .05 * (my.x - n.x) / diff,
                    d = .05 * (my.y - n.y) / diff;
                my.accel.x += a / (b + .3) * _c;
                my.accel.y += a / (b + .3) * d;
                n.accel.x -= b / (a + .3) * _c;
                n.accel.y -= b / (a + .3) * d;
            };
            const firmCollide = (my, n, buffer = 0) => {
                let item1 = {
                        x: my.x + my.m_x,
                        y: my.y + my.m_y
                    },
                    item2 = {
                        x: n.x + n.m_x,
                        y: n.y + n.m_y
                    },
                    dist = util.getDistance(item1, item2),
                    s1 = Math.max(my.velocity.length, my.topSpeed),
                    s2 = Math.max(n.velocity.length, n.topSpeed),
                    strike1,
                    strike2;
                if (dist === 0) {
                    let oops = new Vector(Math.random() * 2 - 1, Math.random() * 2 - 1);
                    my.accel.x += oops.x;
                    my.accel.y += oops.y;
                    n.accel.x -= oops.x;
                    n.accel.y -= oops.y;
                    return;
                }
                if (buffer > 0 && dist <= my.realSize + n.realSize + buffer) {
                    let repel = (my.acceleration + n.acceleration) * (my.realSize + n.realSize + buffer - dist) / buffer / room.speed;
                    my.accel.x += repel * (item1.x - item2.x) / dist;
                    my.accel.y += repel * (item1.y - item2.y) / dist;
                    n.accel.x -= repel * (item1.x - item2.x) / dist;
                    n.accel.y -= repel * (item1.y - item2.y) / dist;
                }
                while (dist <= my.realSize + n.realSize && !(strike1 && strike2)) {
                    strike2 = strike1 = false;
                    if (my.velocity.length <= s1) {
                        my.velocity.x -= .05 * (item2.x - item1.x) / dist / room.speed;
                        my.velocity.y -= .05 * (item2.y - item1.y) / dist / room.speed;
                    } else strike1 = true;
                    if (n.velocity.length <= s2) {
                        n.velocity.x += .05 * (item2.x - item1.x) / dist / room.speed;
                        n.velocity.y += .05 * (item2.y - item1.y) / dist / room.speed;
                    } else strike2 = true;
                    item1 = {
                        x: my.x + my.m_x,
                        y: my.y + my.m_y
                    };
                    item2 = {
                        x: n.x + n.m_x,
                        y: n.y + n.m_y
                    };
                    dist = util.getDistance(item1, item2);
                }
            };
            const advancedCollide = (my, n, doDamage, doInelastic, nIsFirmCollide = false) => {
                let tock = Math.min(my.stepRemaining, n.stepRemaining),
                    combinedRadius = n.size + my.size,
                    motion = {
                        _me: new Vector(my.m_x, my.m_y),
                        _n: new Vector(n.m_x, n.m_y)
                    },
                    delt = new Vector(tock * (motion._me.x - motion._n.x), tock * (motion._me.y - motion._n.y)),
                    diff = new Vector(my.x - n.x, my.y - n.y),
                    dir = new Vector(n.x - my.x, n.y - my.y).unit(),
                    component = Math.max(0, dir.x * delt.x + dir.y * delt.y);
                if (component >= diff.length - combinedRadius) {
                    let goAhead = false,
                        tmin = 1 - tock,
                        //tmax = 1,
                        A = Math.pow(delt.x, 2) + Math.pow(delt.y, 2),
                        B = 2 * delt.x * diff.x + 2 * delt.y * diff.y,
                        C = Math.pow(diff.x, 2) + Math.pow(diff.y, 2) - Math.pow(combinedRadius, 2),
                        det = B * B - (4 * A * C),
                        t;
                    if (!A || det < 0 || C < 0) {
                        t = 0;
                        if (C < 0) goAhead = true;
                    } else {
                        let t1 = (-B - Math.sqrt(det)) / (2 * A),
                            t2 = (-B + Math.sqrt(det)) / (2 * A);
                        if (t1 < tmin || t1 > 1) {
                            if (t2 < tmin || t2 > 1) t = false;
                            else {
                                t = t2;
                                goAhead = true;
                            }
                        } else {
                            if (t2 >= tmin && t2 <= 1) t = Math.min(t1, t2);
                            else t = t1;
                            goAhead = true;
                        }
                    }
                    if (goAhead) {
                        my.collisionArray.push(n);
                        n.collisionArray.push(my);
                        if (t) {
                            my.x += motion._me.x * t;
                            my.y += motion._me.y * t;
                            n.x += motion._n.x * t;
                            n.y += motion._n.y * t;
                            my.stepRemaining -= t;
                            n.stepRemaining -= t;
                            diff = new Vector(my.x - n.x, my.y - n.y);
                            dir = new Vector(n.x - my.x, n.y - my.y).unit();
                            component = Math.max(0, dir.x * delt.x + dir.y * delt.y);
                        }
                        let componentNorm = component / delt.length,
                            deathFactor = {
                                _me: 1,
                                _n: 1
                            },
                            accelerationFactor = delt.length ? combinedRadius / 4 / (Math.floor(combinedRadius / delt.length) + 1) : .001, //
                            depth = {
                                _me: util.clamp((combinedRadius - diff.length) / (2 * my.size), 0, 1),
                                _n: util.clamp((combinedRadius - diff.length) / (2 * n.size), 0, 1)
                            },
                            combinedDepth = {
                                up: depth._me * depth._n,
                                down: (1 - depth._me) * (1 - depth._n)
                            },
                            pen = {
                                _me: {
                                    sqr: Math.pow(my.penetration, 2),
                                    sqrt: Math.sqrt(my.penetration)
                                },
                                _n: {
                                    sqr: Math.pow(n.penetration, 2),
                                    sqrt: Math.sqrt(n.penetration)
                                }
                            },
                            savedHealthRatio = {
                                _me: my.health.ratio,
                                _n: n.health.ratio
                            };
                        if (doDamage) {
                            let speedFactor = {
                                    _me: my.maxSpeed ? Math.pow(motion._me.length / my.maxSpeed, .25) : 1,
                                    _n: n.maxSpeed ? Math.pow(motion._n.length / n.maxSpeed, .25) : 1
                                },
                                bail = false;
                            if (my.shape === n.shape && my.settings.isNecromancer && n.type === "food") bail = my.necro(n);
                            else if (my.shape === n.shape && n.settings.isNecromancer && my.type === "food") bail = n.necro(my);
                            if (!bail) {
                                let resistDiff = my.health.resist - n.health.resist,
                                    damage = {
                                        _me: c.DAMAGE_CONSTANT * my.damage * (1 + resistDiff) *
                                            (1 + n.heteroMultiplier * (my.settings.damageClass === n.settings.damageClass)) *
                                            ((my.settings.buffVsFood && n.settings.damageType === 1) ? 3 : 1) *
                                            my.damageMultiplier() * Math.min(2, Math.max(speedFactor._me, 1) * speedFactor._me), //Math.min(2, 1),
                                        _n: c.DAMAGE_CONSTANT * n.damage * (1 - resistDiff) *
                                            (1 + my.heteroMultiplier * (my.settings.damageClass === n.settings.damageClass)) *
                                            ((n.settings.buffVsFood && my.settings.damageType === 1) ? 3 : 1) *
                                            n.damageMultiplier() * Math.min(2, Math.max(speedFactor._n, 1) * speedFactor._n) //Math.min(2, 1)
                                    };
                                if (my.settings.ratioEffects) damage._me *= Math.min(1, Math.pow(Math.max(my.health.ratio, my.shield.ratio), 1 / my.penetration));
                                if (n.settings.ratioEffects) damage._n *= Math.min(1, Math.pow(Math.max(n.health.ratio, n.shield.ratio), 1 / n.penetration));
                                if (my.settings.damageEffects) damage._me *= accelerationFactor * (1 + (componentNorm - 1) * (1 - depth._n) / my.penetration) * (1 + pen._n.sqrt * depth._n - depth._n) / pen._n.sqrt;
                                if (n.settings.damageEffects) damage._n *= accelerationFactor * (1 + (componentNorm - 1) * (1 - depth._me) / n.penetration) * (1 + pen._me.sqrt * depth._me - depth._me) / pen._me.sqrt;
                                let damageToApply = {
                                    _me: damage._me,
                                    _n: damage._n
                                };
                                if (n.shield.max) damageToApply._me -= n.shield.getDamage(damageToApply._me);
                                if (my.shield.max) damageToApply._n -= my.shield.getDamage(damageToApply._n);
                                let stuff = my.health.getDamage(damageToApply._n, false);
                                deathFactor._me = stuff > my.health.amount ? my.health.amount / stuff : 1;
                                stuff = n.health.getDamage(damageToApply._me, false);
                                deathFactor._n = stuff > n.health.amount ? n.health.amount / stuff : 1;
                                if (n.crit.enabled && Number.isInteger(n.crit.mult) && Number.isInteger(n.crit.chance)) {
                                    let critNumber = ran.randomRange(1, 100);
                                    if ((critNumber < n.crit.chance) && !my.immuneToAbilities) my.damageReceived += damage._n * deathFactor._n * (n.crit.mult * 2 + 1);
                                    else my.damageReceived += damage._n * deathFactor._n;
                                } else my.damageReceived += damage._n * deathFactor._n;
                                if (my.crit.enabled && Number.isInteger(my.crit.mult) && Number.isInteger(my.crit.chance)) {
                                    let critNumber = ran.randomRange(1, 100);
                                    if ((critNumber < my.crit.chance) && !n.immuneToAbilities) n.damageReceived += damage._me * deathFactor._me * (my.crit.mult * 2 + 1);
                                    else n.damageReceived += damage._me * deathFactor._me;
                                } else n.damageReceived += damage._me * deathFactor._me;
                            }
                            if (n.iceStatic.enabled) {
                                my.ice.active = true;
                                my.ice.mult = n.iceStatic.mult;
                                my.ice.time = n.iceStatic.duration;
                                my.ice.remaining = n.master.health.amount;
                            }
                            if (my.iceStatic.enabled) {
                                n.ice.active = true;
                                n.ice.mult = my.iceStatic.mult;
                                n.ice.time = my.iceStatic.duration;
                                n.ice.remaining = my.master.health.amount;
                            }
                            if (n.poisonStatic.enabled) {
                                my.poison.active = true;
                                my.poison.mult = n.poisonStatic.mult;
                                my.poison.time = n.poisonStatic.duration;
                                my.poison.remaining = n.master.health.amount;
                            }
                            if (my.poisonStatic.enabled) {
                                n.poison.active = true;
                                n.poison.mult = my.poisonStatic.mult;
                                n.poison.time = my.poisonStatic.duration;
                                n.poison.remaining = my.master.health.amount;
                            }
                        }
                        if (nIsFirmCollide < 0) {
                            nIsFirmCollide *= -.5;
                            my.accel.x -= nIsFirmCollide * component * dir.x;
                            my.accel.y -= nIsFirmCollide * component * dir.y;
                            n.accel.x += nIsFirmCollide * component * dir.x;
                            n.accel.y += nIsFirmCollide * component * dir.y;
                        } else if (nIsFirmCollide > 0) {
                            n.accel.x += nIsFirmCollide * (component * dir.x + combinedDepth.up);
                            n.accel.y += nIsFirmCollide * (component * dir.y + combinedDepth.up);
                        } else {
                            let elasticity = 2 - 4 * Math.atan(my.penetration * n.penetration) / Math.PI;
                            if (doInelastic && my.settings.motionEffects && n.settings.motionEffects) elasticity *= savedHealthRatio._me / pen._me.sqrt + savedHealthRatio._n / pen._n.sqrt;
                            else elasticity *= 2;
                            let spring = 2 * Math.sqrt(savedHealthRatio._me * savedHealthRatio._n) / room.speed,
                                elasticImpulse = Math.pow(combinedDepth.down, 2) * elasticity * component * my.mass * n.mass / (my.mass + n.mass),
                                springImpulse = c.KNOCKBACK_CONSTANT * spring * combinedDepth.up,
                                impulse = -(elasticImpulse + springImpulse) * (1 - my.intangibility) * (1 - n.intangibility),
                                force = {
                                    x: impulse * dir.x,
                                    y: impulse * dir.y
                                },
                                modifiers = {
                                    _me: c.KNOCKBACK_CONSTANT * my.pushability / my.mass * deathFactor._n,
                                    _n: c.KNOCKBACK_CONSTANT * n.pushability / n.mass * deathFactor._me
                                };
                            my.accel.x += modifiers._me * force.x;
                            my.accel.y += modifiers._me * force.y;
                            n.accel.x -= modifiers._n * force.x;
                            n.accel.y -= modifiers._n * force.y;
                        }
                    }
                }
            };
            const reflectCollide = (wall, bounce) => {
                if (bounce.x + bounce.size < wall.x - wall.size || bounce.x - bounce.size > wall.x + wall.size || bounce.y + bounce.size < wall.y - wall.size || bounce.y - bounce.size > wall.y + wall.size) return 0;
                let bounceBy = bounce.type === "tank" ? .65 : bounce.type === "food" || bounce.type === "crasher" ? .8 : bounce.type === "miniboss" ? .85 : .35,
                    left = bounce.x < wall.x - wall.size,
                    right = bounce.x > wall.x + wall.size,
                    top = bounce.y < wall.y - wall.size,
                    bottom = bounce.y > wall.y + wall.size,
                    leftExposed = bounce.x - bounce.size < wall.x - wall.size,
                    rightExposed = bounce.x + bounce.size > wall.x + wall.size,
                    topExposed = bounce.y - bounce.size < wall.y - wall.size,
                    bottomExposed = bounce.y + bounce.size > wall.y + wall.size,
                    intersected = true;
                if ((leftExposed && rightExposed) || (topExposed && bottomExposed)) return;
                else if ((left && !top && !bottom) || (leftExposed && !topExposed && !bottomExposed)) bounce.accel.x -= (bounce.x + bounce.size - wall.x + wall.size) * bounceBy;
                else if ((right && !top && !bottom) || (rightExposed && !topExposed && !bottomExposed)) bounce.accel.x -= (bounce.x - bounce.size - wall.x - wall.size) * bounceBy;
                else if ((top && !left && !right) || (topExposed && !leftExposed && !rightExposed)) bounce.accel.y -= (bounce.y + bounce.size - wall.y + wall.size) * bounceBy;
                else if ((bottom && !left && !right) || (bottomExposed && !leftExposed && !rightExposed)) bounce.accel.y -= (bounce.y - bounce.size - wall.y - wall.size) * bounceBy;
                else {
                    let x = leftExposed ? -wall.size : rightExposed ? wall.size : 0,
                        y = topExposed ? -wall.size : bottomExposed ? wall.size : 0,
                        point = new Vector(wall.x + x - bounce.x, wall.y + y - bounce.y);
                    if (!x || !y) {
                        if (bounce.x + bounce.y < wall.x + wall.y) {
                            if (bounce.x - bounce.y < wall.x - wall.y) bounce.accel.x -= (bounce.x + bounce.size - wall.x + wall.size) * bounceBy;
                            else bounce.accel.y -= (bounce.y + bounce.size - wall.y + wall.size) * bounceBy;
                        } else {
                            if (bounce.x - bounce.y < wall.x - wall.y) bounce.accel.y -= (bounce.y - bounce.size - wall.y - wall.size) * bounceBy;
                            else bounce.accel.x -= (bounce.x - bounce.size - wall.x - wall.size) * bounceBy;
                        }
                    } else if (!(left || right || top || bottom)) {
                        let force = (bounce.size / point.length - 1) * bounceBy / 2;
                        bounce.accel.x += point.x * force;
                        bounce.accel.y += point.y * force;
                    } else if (point.isShorterThan(bounce.size)) {
                        let force = (bounce.size / point.length - 1) * bounceBy / 2;
                        bounce.accel.x -= point.x * force;
                        bounce.accel.y -= point.y * force;
                    } else intersected = false;
                }
                if (intersected) {
                    if (!bounce.godmode)
                        if (bounce.type !== "bullet") {
                            if (bounce.collisionArray.some(body => body.type === "mazeWall") && util.getDistance(wall, bounce) < wall.size * 1.25) bounce.kill();
                        } else bounce.kill();
                    bounce.collisionArray.push(wall);
                }
            };
            const growOnCollision = (instance, other) => {
                if (instance.SIZE >= other.SIZE) {
                    instance.SIZE += 7;
                    other.kill();
                } else {
                    other.SIZE += 7;
                    instance.kill();
                }
            };
            // Passive Mode Collisions
            if (instance.passive || other.passive) {
                if (instance.passive && other.passive && instance.settings.hitsOwnType === other.settings.hitsOwnType) switch (instance.settings.hitsOwnType) {
                    case "mountain":
                        if (instance.master.id === other.master.id) growOnCollision(instance, other);
                    case "push":
                        if (instance.master.id === other.master.id) advancedCollide(instance, other, false, false);
                        break;
                    case "hard":
                        firmCollide(instance, other);
                        break;
                    case "hardWithBuffer":
                        if (instance.master.id === other.master.id) firmCollide(instance, other, 30);
                        break;
                    case "hardOnlyDrones":
                        if (instance.master.id === other.master.id) firmCollide(instance, other);
                        break;
                }
                return;
            }
            // Dominator/Mothership Collisions
            if (instance.team === other.team && (instance.settings.hitsOwnType === "pushOnlyTeam" || other.settings.hitsOwnType === "pushOnlyTeam")) {
                if (instance.settings.hitsOwnType === other.settings.hitsOwnType) return;
                let pusher = instance.settings.hitsOwnType === "pushOnlyTeam" ? instance : other,
                    entity = instance.settings.hitsOwnType === "pushOnlyTeam" ? other : instance;
                if (entity.settings.goThruObstacle || entity.type !== "tank" || entity.settings.hitsOwnType === "never") return;
                if (entity.settings.isHelicopter) {
                    if (!entity.godmode && !entity.invuln) entity.health.amount -= .9;
                    return;
                }
                let a = 1 + 10 / (Math.max(entity.velocity.length, pusher.velocity.length) + 10);
                advancedCollide(pusher, entity, false, false, a);
            }
            // Obstacle Collision
            else if (instance.type === "wall" || other.type === "wall") {
                let wall = instance.type === "wall" ? instance : other,
                    entity = instance.type === "wall" ? other : instance;
                if (entity.settings.diesByObstacles) return entity.kill();
                if (entity.settings.goThruObstacle || entity.type === "mazeWall" || entity.isDominator) return;
                if (entity.settings.isHelicopter) {
                    if (!entity.godmode && !entity.invuln) entity.health.amount -= .9;
                    return;
                }
                let a = entity.type === "bullet" || entity.type === "trap" ? 1 + 10 / (Math.max(entity.velocity.length, wall.velocity.length) + 10) : 1;
                advancedCollide(wall, entity, false, false, a);
            }
            // Shield Collision
            else if (instance.settings.hitsOwnType === "shield" || other.settings.hitsOwnType === "shield") {
                if (instance.team === other.team || instance.master.id === other.master.id) return;
                let shield = instance.settings.hitsOwnType === "shield" ? instance : other,
                    entity = instance.settings.hitsOwnType === "shield" ? other : instance;
                if (entity.settings.goThruObstacle || entity.type === "wall" || entity.type === "food" || entity.type === "mazeWall" || entity.isDominator || entity.master.isDominator || shield.master.id === entity.id) return;
                firmCollide(shield, entity);
            }
            // Vaccine Collision
            else if (instance.settings.hitsOwnType === "vaccine" || other.settings.hitsOwnType === "vaccine") {
                let vaccinator = instance.settings.hitsOwnType === "vaccine" ? instance : other,
                    entity = instance.settings.hitsOwnType === "vaccine" ? other : instance;
                if (vaccinator.team !== entity.team) {
                    if (vaccinator.settings.hitsOwnType === "vaccine" && vaccinator.poisonStatic.enabled === true) {
                        entity.poison.active = true;
                        entity.poison.mult = vaccinator.poisonStatic.mult;
                        entity.poison.time = vaccinator.poisonStatic.duration;
                        entity.poison.remaining = vaccinator.master.health.amount;
                    }
                    if (vaccinator.settings.hitsOwnType === "vaccine" && vaccinator.empStatic.enabled === true && (!entity.isDominator || !entity.master.isDominator)) {
                        entity.emp.active = true;
                        entity.emp.time = vaccinator.empStatic.duration;
                        entity.emp.master = vaccinator.label;
                    }
                    return;
                }
                if (vaccinator.settings.hitsOwnType === "vaccine" && vaccinator.vaccineStatic.enabled === true && vaccinator.master.id !== entity.id) {
                    entity.vaccine.active = true;
                    entity.vaccine.mult = vaccinator.vaccineStatic.mult;
                    entity.vaccine.time = vaccinator.vaccineStatic.duration;
                    entity.vaccine.remaining = vaccinator.master.health.amount;
                }
                if (entity.settings.goThruObstacle || entity.type === "wall" || entity.type === "mazeWall" || entity.isDominator || entity.master.isDominator || vaccinator.master.id === entity.id) return;
                firmCollide(vaccinator, entity);
            }
            // Maze Wall Collision
            else if (instance.type === "mazeWall" || other.type === "mazeWall") {
                if (instance.type === other.type) return;
                let wall = instance.type === "mazeWall" ? instance : other,
                    entity = instance.type === "mazeWall" ? other : instance;
                if (entity.settings.goThruObstacle || entity.type === "wall" || entity.isDominator/* || entity.type === "crasher"*/) return;
                if (entity.settings.isHelicopter) {
                    if (!entity.godmode && !entity.invuln && util.getDistance(wall, entity) < wall.size * 1.35) entity.health.amount -= .9;
                    return;
                }
                reflectCollide(wall, entity);
            }
            // Crasher-Food Collision
            else if (instance.type === "crasher" && other.type === "food" || other.type === "crasher" && instance.type === "food") firmCollide(instance, other);
            // Player Collision
            else if (instance.team !== other.team) advancedCollide(instance, other, true, true);
            // No Collision
            else if (instance.settings.hitsOwnType === "never" || other.settings.hitsOwnType === "never") return;
            // Standard Collision
            else if (instance.settings.hitsOwnType === other.settings.hitsOwnType && !instance.multibox.enabled && !other.multibox.enabled) switch (instance.settings.hitsOwnType) {
                case "mountain":
                    if (instance.master.id === other.master.id) growOnCollision(instance, other);
                case "push":
                    advancedCollide(instance, other, false, false);
                    break;
                case "hard":
                    firmCollide(instance, other);
                    break;
                case "hardWithBuffer":
                    if (instance.master.id === other.master.id) firmCollide(instance, other, 30);
                    break;
                case "hardOnlyDrones":
                    if (instance.master.id === other.master.id) firmCollide(instance, other);
                    break;
                case "hardOnlyTanks":
                    if (instance.type === "tank" && other.type === "tank" && !instance.isDominator && !other.isDominator) firmCollide(instance, other);
                    break;
                case "repel":
                    simpleCollide(instance, other);
                    break;
            }
        };
    })();
    const entitiesActivationLoop = my => {
        my.collisionArray = [];
        my.activation.update();
        my.updateAABB(my.activation.check());
    };
    const entitiesLiveLoop = my => {
        if (my.death()) my.destroy();
        else {
            if (my.bond == null) {
                logs.physics.set();
                my.physics();
                logs.physics.mark();
            }
            if (my.activation.check()) {
                logs.entities.tally();
                logs.life.set();
                my.life();
                logs.life.mark();
                my.friction();
                my.location();
                logs.selfie.set();
                my.takeSelfie();
                logs.selfie.mark();
            }
        }
        my.collisionArray = [];
    };
    return () => {
        logs.loops.tally();
        logs.master.set();
        logs.activation.set();
        for (let e of entities) entitiesActivationLoop(e);
        logs.activation.mark();
        logs.collide.set();
        if (entities.length > 1) {
            grid.update();
            for (let collision of grid.queryForCollisionPairs()) collide(collision);
        }
        logs.collide.mark();
        logs.entities.set();
        for (let e of entities) entitiesLiveLoop(e);
        logs.entities.mark();
        logs.master.mark();
        purgeEntities();
        room.lastCycle = util.time();
    };
})();
const abilityLoop = (() => {
    const ice = () => {
        for (let body of entities)
            if (body.godmode || body.invuln || body.immuneToAbilities) {
                body.ice.time = 0;
                body.ice.active = false;
            } else if (body.ice.active && !body.immuneToAbilities) {
                body.ice.time--;
                body.velocity.x -= body.velocity.x / body.ice.mult;
                body.velocity.y -= body.velocity.y / body.ice.mult;
                if (body.ice.time < -1) body.ice.active = false;
            } else if (body.ice.remaining <= .00025 || body.ice.time < -1) body.ice.active = false;
    };
    const poison = () => {
        for (let body of entities)
            if (body.godmode || body.invuln || body.health.amount <= 10 || body.immuneToAbilities) {
                body.poison.time = 0;
                body.poison.active = false;
            } else if (body.poison.active && !body.immuneToAbilities) {
                body.poison.time--;
                body.health.amount -= body.poison.mult * .89;
                if (body.poison.time < -1) body.poison.active = false;
            } else if (body.poison.remaining <= .025 || body.poison.time < -1) body.poison.active = false;
    };
    const vaccine = () => {
        for (let body of entities)
            if (body.godmode || body.invuln || body.health.amount >= body.health.max || body.immuneToAbilities) {
                body.vaccine.time = 0;
                body.vaccine.active = false;
            } else if (body.vaccine.active && !body.immuneToAbilities) {
                body.vaccine.time--;
                body.health.amount += body.vaccine.mult * .925;
                if (body.vaccine.time < -1) body.vaccine.active = false;
            } else if (body.vaccine.time < -1) body.vaccine.active = false;
    };
    const emp = () => {
        for (let body of entities)
            if (body.godmode || body.invuln || body.immuneToAbilities) {
                body.emp.time = 0;
                body.emp.active = false;
            } else if (body.emp.active && !body.immuneToAbilities) {
                body.emp.time--;
                if (body.emp.master === 'Surge Line') body.velocity.x = body.velocity.y = 0;
                if (body.emp.time < -1) body.emp.active = false;
            } else if (body.emp.time < -1) body.emp.active = false;
    };
    return () => {
        ice();
        poison();
        vaccine();
        emp();
    };
})();
const maintainLoop = (() => {
    const placeObstacles = () => {
        if (room.modelMode) return;
        const place = (loc, type) => {
            let x = 0,
                position;
            do {
                position = room.randomType(loc);
                x++;
                if (x > 200) {
                    util.warn("Failed to place obstacles!");
                    return 0;
                }
            } while (dirtyCheck(position, 10 + type.SIZE));
            let o = new Entity(position);
            o.define(type);
            o.team = -101;
            o.facing = ran.randomAngle();
            o.protect();
            o.life();
        }
        let roidCount = room.roid.length * room.width * room.height / room.xgrid / room.ygrid / 5e4 / 1.5,
            rockCount = room.rock.length * room.width * room.height / room.xgrid / room.ygrid / 25e4 / 1.5,
            count = 0;
        for (let i = Math.ceil(roidCount * .2); i; i--) {
            count++;
            place("roid", Class.megaObstacle);
        }
        for (let i = Math.ceil(roidCount); i; i--) {
            count++;
            place("roid", Class.obstacle);
        }
        for (let i = Math.ceil(roidCount * .4); i; i--) {
            count++;
            place("roid", Class.babyObstacle);
        }
        for (let i = Math.ceil(rockCount * .1); i; i--) {
            count++;
            place("rock", Class.megaObstacle);
        }
        for (let i = Math.ceil(rockCount * .2); i; i--) {
            count++;
            place("rock", Class.obstacle);
        }
        for (let i = Math.ceil(rockCount * .4); i; i--) {
            count++;
            place("rock", Class.babyObstacle);
        }
        util.log("Placed " + count + " obstacles.");
    }
    if (!room.modelMode) placeObstacles();
    if (c.MAZE.ENABLED) {
        class MazeGenerator {
            constructor() {
                this.init();
            }
            init() {
                let mapString = require("./lib/mazes")[c.MAZE.METHOD];
                this.maze = mapString.trim().split('\n').map(r => r.trim().split('').map(r => r === '@'));
            }
            clear() {
                this.maze = Array(32).fill().map(() => Array(32).fill(false));
            }
            isClosed() {
                let cells = [].concat(...this.maze.map((r, x) => r.map((r, y) => [x, y, r]).filter(([x, y, r]) => !r))).map(([x, y]) => [x, y, x === 0 || x === 31 || y === 0 || y === 31]),
                    work = true;
                while (work) {
                    work = false;
                    for (let [x, y, open] of cells)
                        if (open)
                            for (let other of cells) {
                                let [ox, oy, oOpen] = other;
                                if (!oOpen && (Math.abs(ox - x) + Math.abs(oy - y) === 1)) {
                                    other[2] = true;
                                    work = true;
                                }
                            }
                }
                return cells.some(r => !r[2]);
            }
            randomErosion(side = null, corner = null) {
                for (let i = 0; i < 2000; i++) {
                    let x = Math.floor(Math.random() * 32),
                        y = Math.floor(Math.random() * 32);
                    if (this.maze[x][y]) continue;
                    if ((x === 0 || x === 31) && (y === 0 || y === 31)) continue;
                    let direction = Math.floor(Math.random() * 4);
                    if (x === 0) direction = 0;
                    else if (y === 0) direction = 1;
                    else if (x === 31) direction = 2;
                    else if (y === 31) direction = 3;
                    let tx = direction === 0 ? x + 1 : direction === 2 ? x - 1 : x,
                        ty = direction === 1 ? y + 1 : direction === 3 ? y - 1 : y;
                    if (!this.maze[tx][ty]) continue;
                    if (corner !== null) {
                        let left = this.maze[direction === 2 || direction === 3 ? x - 1 : x + 1][direction === 0 || direction === 3 ? y - 1 : y + 1],
                            right = this.maze[direction === 1 || direction === 2 ? x - 1 : x + 1][direction === 2 || direction === 3 ? y - 1 : y + 1];
                        if ((corner === true && (left || right)) || (corner === +left + +right)) {} else continue;
                    }
                    if (side !== null) {
                        let left = this.maze[direction === 3 ? x + 1 : direction === 1 ? x - 1 : x][direction === 0 ? y + 1 : direction === 2 ? y - 1 : y],
                            right = this.maze[direction === 1 ? x + 1 : direction === 3 ? x - 1 : x][direction === 2 ? y + 1 : direction === 0 ? y - 1 : y];
                        if ((side === true && (left || right)) || (side === +left + +right)) {} else continue;
                    }
                    return [tx, ty, x, y];
                }
                throw new Error('Unable to find suitable erosion site!');
            }
            erode(side, corner) {
                let [x, y] = this.randomErosion(side, corner);
                this.maze[x][y] = false;
            }
            run() {
                let erosion = c.MAZE.EROSION;
                for (let i = 0; i < erosion[0]; i++) this.erode(0, 2);
                for (let i = 0; i < erosion[1]; i++) {
                    this.erode(0, 2);
                    this.erode(2, 2);
                    this.erode(2, 2);
                    this.erode(2, 2);
                }
                for (let i = 0; i < erosion[2]; i++) {
                    this.erode(1, 2);
                    this.erode(0, 2);
                    this.erode(2, 2);
                    this.erode(2, 2);
                    this.erode(2, 2);
                }
                for (let i = 0; i < erosion[3]; i++) this.erode(1, 2);
                for (let i = 0; i < erosion[4]; i++) {
                    this.erode(0, 2);
                    this.erode(2, 2);
                    this.erode(2, 2);
                    this.erode(2, 2);
                }
                for (let i = 0; i < erosion[5]; i++) this.erode(0, 0);
                return this;
            }
            start() {
                let data = [1, 500];
                if (this.sym === 1) data = [1, 500];
                else if (this.sym === 2) data = [2, 500];
                else if (this.sym === 3) data = [3, 500];
                else if (this.sym === 4) data = [4, 500];
                for (let i = 0; i < data[1]; i++) try {
                    this.run(data[0]);
                    if (!this.isClosed()) return this;
                } catch (e) {}
                this.clear();
                return this;
            }
            place() {
                let scale = room.width / 32,
                    count = 0;
                for (let x = 0; x < 32; x++)
                    for (let y = 0; y < 32; y++)
                        if (this.maze[x][y]) {
                            let o = new Entity({
                                x: (x + .5) * scale,
                                y: (y + .5) * scale
                            });
                            o.define(Class.mazeObstacle);
                            o.SIZE = .504 * scale;
                            o.team = -101;
                            o.protect();
                            o.life();
                            count++;
                        }
                util.log("Placed " + count + " Maze Walls.");
                if (count === 0) {
                    util.warn("An error occurred during the erosion process! Restarting...");
                    process.exit();
                }
            }
        };
        const Maze = new MazeGenerator();
        Maze.start();
        Maze.place();
    }
    const spawnBosses = (() => {
        if (room.modelMode) return;
        let timer = 0;
        const boss = (() => {
            let i = 0,
                names = [],
                bois = [Class.egg],
                n = 0,
                begin = "Placeholder message for spawnBosses.begin()",
                arrival = "Placeholder message for spawnBosses.arrival()",
                loc = "norm";
            const spawn = () => {
                let spot,
                    max = 150;
                do spot = room.randomType(loc);
                while (dirtyCheck(spot, 500) && max-- > 0);
                let o = new Entity(spot);
                o.define(ran.choose(bois));
                o.team = -100;
                o.name = names[i++];
            };
            return {
                prepareToSpawn: (classArray, number, nameClass, typeOfLocation = "norm") => {
                    n = number;
                    bois = classArray;
                    loc = typeOfLocation;
                    names = ran.chooseBossName(nameClass, number);
                    i = 0;
                    if (n === 1) {
                        begin = "A boss is coming...";
                        arrival = names[0] + " has arrived!";
                    } else {
                        begin = "Bosses are coming...";
                        arrival = "";
                        for (let i = 0; i < n - 2; i++) arrival += names[i] + ", ";
                        arrival += names[n - 2] + " and " + names[n - 1] + " have arrived!";
                    }
                },
                spawn: () => {
                    sockets.broadcast(begin);
                    for (let i = 0; i < n; i++) setTimeout(spawn, ran.randomRange(3500, 5000));
                    setTimeout(() => sockets.broadcast(arrival), 5000);
                    util.spawn(arrival);
                }
            };
        })();
        return census => {
            if (timer > c.BOSS_SPAWN_TIMER && ran.dice(3 * c.BOSS_SPAWN_TIMER - timer)) {
                util.spawn("Preparing to spawn bosses...");
                timer = 0;
                let choice = [];
                switch (Math.floor(27 * Math.random())) {
                    case 0:
                    case 1:
                    case 2: // Elite Bosses
                        choice = [[
                            Class.eliteDestroyerAI,
                            Class.eliteGunnerAI,
                            Class.eliteSprayerAI,
                            Class.eliteTwinAI,
                            Class.eliteMachineAI,
                            Class.eliteTrapAI,
                            Class.eliteBorerAI,
                            Class.eliteSniperAI,
                            Class.eliteBasicAI,
                            Class.eliteInfernoAI
                        ], Math.floor(2 * Math.random()) + 1, "a", "nest"];
                        sockets.broadcast("A stirring in the distance...");
                        break;
                    case 3:
                    case 4: // Fallen Bosses
                        choice = [[
                            Class.fallenBoosterAI,
                            Class.fallenOverlordAI,
                            Class.fallenPistonAI,
                            Class.fallenAutoTankAI,
                            Class.fallenCavalcadeAI,
                            Class.fallenFighterAI
                        ], Math.floor(3 * Math.random()) + 1, "a", "norm"];
                        sockets.broadcast("The dead are rising...");
                        break;
                    case 5:
                    case 6: // Reanimated Bosses
                        choice = [[Class.reanimFarmerAI, Class.reanimHeptaTrapAI, Class.reanimUziAI], 1, "a", "norm"];
                        sockets.broadcast("Many had sought for the day when they'd return... Just not in this way...");
                        break;
                    case 7:
                    case 8:
                    case 9:
                    case 26: // Low Tier Bosses
                        choice = [[
                            Class.palisadeAI,
                            Class.skimBossAI,
                            Class.leviathanAI,
                            Class.ultMultitoolAI,
                            Class.nailerAI,
                            Class.gravibusAI,
                            Class.cometAI,
                            Class.brownCometAI,
                            Class.orangicusAI,
                            Class.atriumAI,
                            Class.constructionistAI,
                            Class.dropshipAI
                        ], ran.chooseChance(60, 20, 20) + 1, "castle", "norm"];
                        sockets.broadcast("A strange trembling...");
                        break;
                    case 10:
                    case 11: // Army Sentries
                        choice = [[
                            Class.armySentrySwarmAI,
                            Class.armySentryGunAI,
                            Class.armySentryTrapAI,
                            Class.armySentryRangerAI,
                            Class.armySentrySwarmAI,
                            Class.armySentryGunAI,
                            Class.armySentryTrapAI,
                            Class.armySentryRangerAI
                        ], 8, "castle", "nest"];
                        sockets.broadcast("Sentries unite...");
                        break;
                    case 12:
                    case 13:
                    case 14: // High Tier Bosses
                        choice = [[
                            Class.derogatorAI,
                            Class.hexadecagorAI,
                            Class.blitzkriegAI,
                            Class.demolisherAI,
                            Class.octogeddonAI,
                            Class.octagronAI,
                            Class.ultimateAI,
                            Class.cutterAI,
                            Class.alphaSentryAI,
                            Class.asteroidAI
                        ], Math.floor(2 * Math.random()) + 1, "castle", "norm"];
                        sockets.broadcast("Influx detected...");
                        break;
                    case 15:
                    case 16: // Custom Shape Bosses
                        choice = [[
                            Class.trapeFighterAI,
                            Class.visUltimaAI,
                            Class.gunshipAI,
                            Class.messengerAI,
                            Class.pulsarAI,
                            Class.colliderAI,
                            Class.deltrabladeAI,
                            Class.aquamarineAI,
                            Class.kioskAI,
                            Class.vanguardAI,
                            Class.magnetarAI
                        ], Math.floor(2 * Math.random()) + 1, "a", "nest"];
                        sockets.broadcast("Don't get distracted...");
                        break;
                    case 17:
                    case 18: // Lore Bosses
                        choice = [[Class.guardianAI, Class.summonerAI, Class.defenderAI], 3, "a", "nest"];
                        sockets.broadcast("And then they found refuge here.");
                        sockets.broadcast("Copycats of them came to replace them; They had to flee.");
                        sockets.broadcast("First heard of in only myths, the trio has arrived in an alternate dimension.");
                    case 19: // Implosionist
                        choice = [[Class.xyvAI], 1, "castle", "norm"];
                        sockets.broadcast("Souls unite...");
                        break;
                    case 20: // Conquistador
                        choice = [[Class.conquistadorAI], 1, "castle", "norm"];
                        sockets.broadcast("To put it bluntly, he's found it now.");
                        sockets.broadcast("Searching all across the land, he only wanted one thing.");
                        break;
                    case 21: // Sassafras
                        choice = [[Class.sassafrasAI], 1, "sassafras", ["roid", "rock"][Math.floor(2 * Math.random())]];
                        if (Math.floor(25 * Math.random()) === 25) sockets.broadcast("Maybe the bottom of the source code will help...");
                        else sockets.broadcast("i like crackers");
                        break;
                    case 22:
                    case 23:
                    case 24: // Multi-Phase Bosses
                        choice = [[Class.constAI, Class.bowAI, Class.snowflakeAI], 1, "a", ["norm", "nest"][Math.floor(2 * Math.random())]];
                        sockets.broadcast("A disturbance...");
                        break;
                    case 25:
                        choice = [[Class.greenGuardianAI], 1, "a", ["norm", "nest"][Math.floor(2 * Math.random())]];
                        sockets.broadcast("I smell green paint...");
                        break;
                }
                boss.prepareToSpawn(...choice);
                setTimeout(boss.spawn, 3000);
            } else if (!census.miniboss) timer++;
        };
    })();
    const spawnCrasher = census => {
        if (room.modelMode) return;
        if (ran.chance(1 - .5 * census.crasher / room.maxFood / room.nestFoodAmount)) {
            let spot,
                max = 100;
            do spot = room.randomType("nest");
            while (dirtyCheck(spot, 100) && max-- > 0);
            let sentries = [
                    Class.sentryGunAI,
                    Class.sentrySwarmAI,
                    Class.sentryTrapAI,
                    Class.sentryRangerAI,
                    Class.flashSentryAI,
                    Class.semiCrushSentryAI,
                    Class.crushSentryAI,
                    Class.bladeSentryAI,
                    Class.greenSentrySwarmAI,
                    Class.skimSentryAI
                ],
                crashers = [
                    Class.crasher,
                    Class.fastCrasher,
                    Class.semiCrushCrasher,
                    Class.crushCrasher,
                    Class.bladeCrasher,
                    Class.destroyCrasher,
                    Class.wallerCrasher,
                    Class.grouperSpawn,
                    Class.visDestructia,
                    Class.megaCrushCrasher,
                    Class.iceCrusher,
                    Class.poisonBlades,
                    Class.longCrasher,
                    Class.asteroidCrasher,
                    Class.walletCrasher,
                    Class.boomCrasher,
                    Class.zoomCrasher,
                    Class.invisoCrasher,
                    Class.redRunner1,
                    Class.greenRunner,
                    Class.destroyCrasherSquare
                ],
                type = ran.dice(80) ? sentries[ran.chooseChance(15, 15, 15, 15, 12, 10, 8, 8, 8, 8)] : crashers[ran.chooseChance(50, 25, 10, 10, 15, 10, 10, 25, 2, 2, 2, 2, 25, 2, 10, 5, 10, 10, 15, 25, 15)],
                o = new Entity(spot);
            o.define(type);
            o.team = -100;
        }
    };
    const makeNPCs = (() => {
        if (room.modelMode) return;
        if (room.gameMode === "tdm") {
            for (let i = 1; i < room.teamAmount + 1; i++)
                for (let loc of room["bas" + i]) {
                    let o = new Entity(loc);
                    //o.define([Class.baseProtector, Class.baseProtectorDestroyer][Math.floor(Math.random() * 2)]);
                    o.define(Class.baseProtector);
                    o.team = -i;
                    o.color = [10, 12, 11, 15, 3, 35, 36, 0][i - 1];
                }
            if (c.serverName.includes("Domination") && room.domi.length > 0) dominatorLoop();
            if (c.serverName.includes("Boss")) bossRushLoop({
                x: Math.random() * room.width,
                y: Math.random() * room.height
            });
            if (c.serverName.includes("Mothership"))
                for (let i = 1; i < room.teamAmount + 1; i++)
                    for (let loc of room["mot" + i]) mothershipLoop(loc, i);
        }
        return () => {
            let census = {
                crasher: 0,
                miniboss: 0,
                tank: 0
            };
            for (let instance of entities)
                if (census[instance.type] != null) census[instance.type]++;
            if (!room.modelMode) spawnCrasher(census);
            if (!room.arenaClosed && !room.modelMode) {
                spawnBosses(census);
                if (room.maxBots > 0) {
                    bots = bots.filter(body => body.isAlive());
                    if (bots.length < room.maxBots) spawnBot();
                }
                sanctuaries = entities.filter(body => body.sanctuaryType !== "None" || body.miscIdentifier === "Sanctuary Boss");
            }
        };
    })();
    const makeFood = (() => {
        if (room.modelMode) return;
        let food = [],
            foodSpawners = [];
        const getFoodClass = level => {
            let a = {},
                selection = 0;
            switch (level) {
                case 0:
                    selection = ran.chooseChance(100, .045, .005);
                    a = [Class.egg, Class.eggSanctuary, Class.sunKing][selection];
                    if (selection === 1) {
                        if (sanctuaries.length >= 1) a = Class.egg;
                        else {
                            sockets.broadcast("An Egg Sanctuary has arrived!");
                            util.spawn("An Egg Sanctuary has spawned.");
                        }
                    } else if (selection === 2) {
                        if (sanctuaries.length >= 1) a = Class.egg;
                        else {
                            sockets.broadcast("A Golden Sanctuary has arrived!");
                            util.spawn("A Golden Sanctuary has been spawned.");
                        }
                    }
                    break;
                case 1:
                    selection = ran.chooseChance(100, 1, .1, .045, 1, 2);
                    a = [Class.square, Class.greenSquare, Class.orangeSquare, Class.squareSanctuary, Class.splitSquareSpawn, Class.splitterSquare][selection];
                    if (selection === 3) {
                        if (sanctuaries.length >= 1) a = Class.square;
                        else {
                            sockets.broadcast("A Square Sanctuary has arrived!");
                            util.spawn("A Square Sanctuary has been spawned.");
                        }
                    }
                    break;
                case 2:
                    selection = ran.chooseChance(100, .85, .1, .045, 1, 2);
                    a = [Class.triangle, Class.greenTriangle, Class.orangeTriangle, Class.triSanctuary, Class.redRunnerSpawn, Class.triBladeSpawn][selection];
                    if (selection === 3) {
                        if (sanctuaries.length >= 1) a = Class.triangle;
                        else {
                            sockets.broadcast("A Triangle Sanctuary has arrived!");
                            util.spawn("A Triangle Sanctuary has been spawned.");
                        }
                    }
                    break;
                case 3:
                    selection = ran.chooseChance(100, .75, .1, .045, 1);
                    a = [Class.pentagon, Class.greenPentagon, Class.orangePentagon, Class.pentaSanctuary, Class.splitterPentagon][selection];
                    if (selection === 3) {
                        if (sanctuaries.length >= 1) a = Class.pentagon;
                        else {
                            sockets.broadcast("A Pentagon Sanctuary has arrived!");
                            util.spawn("A Pentagon Sanctuary has been spawned.");
                        }
                    }
                    break;
                case 4:
                    selection = ran.chooseChance(100, .5);
                    a = [Class.betaPentagon, Class.greenBetaPentagon][selection];
                    break;
                case 5:
                    a = Class.alphaPentagon;
                    break;
                case 6:
                    a = Class.hexagon;
                    break;
                case 7:
                    a = Class.heptagon;
                    break;
                case 8:
                    a = Class.octagon;
                    break;
                case 9:
                    a = Class.nonagon;
                    break;
                case 10:
                    a = Class.decagon;
                    break;
                case 11:
                    break;
                default:
                    util.error("Unknown food level: " + level + "!");
                    a = Class.square;
                    break;
            }
            if (a !== {}) a.BODY.ACCELERATION = .015 / (a.FOOD.LEVEL + 1);
            return a;
        };
        const placeNewFood = (position, scatter, level, allowInNest = false) => {
            let o = nearest(food, position),
                mitosis = false,
                seed = false;
            if (o != null)
                for (let i = 50; i > 0; i--)
                    if (scatter === -1 || util.getDistance(position, o) < scatter)
                        if (ran.dice((o.foodLevel + 1) * (o.foodLevel + 1))) {
                            mitosis = true;
                            break;
                        } else {
                            seed = true;
                            break;
                        }
            let levelToCheck = mitosis ? o.foodLevel < 11 : level < 11;
            if (levelToCheck && (scatter !== -1 || mitosis || seed))
                if (o != null && (mitosis || seed) && room.isIn("nest", o) === allowInNest) {
                    let levelToMake = mitosis ? o.foodLevel : level,
                        place = {
                            x: o.x + o.size * Math.cos(o.facing),
                            y: o.y + o.size * Math.sin(o.facing)
                        },
                        new_o = new Entity(place);
                    new_o.define(getFoodClass(levelToMake));
                    new_o.team = -100;
                    new_o.facing = o.facing + ran.randomRange(.5 * Math.PI, Math.PI);
                    food.push(new_o);
                    return new_o;
                } else if (room.isIn("nest", position) === allowInNest && !dirtyCheck(position, 20)) {
                    o = new Entity(position);
                    o.define(getFoodClass(level));
                    o.team = -100;
                    o.facing = ran.randomAngle();
                    food.push(o);
                    return o;
                }
        };
        const FoodSpawner = class {
            constructor() {
                this.foodToMake = Math.ceil(Math.abs(ran.gauss(0, room.scale.linear * 80)));
                this.size = Math.sqrt(this.foodToMake) * 25;
                let position = {},
                    o;
                do {
                    position = room.gaussRing(1 / 3, 20);
                    o = placeNewFood(position, this.size, 0);
                } while (o == null);
                for (let i = Math.ceil(Math.abs(ran.gauss(0, 4))); i <= 0; i--) placeNewFood(o, this.size, 0);
                this.x = o.x;
                this.y = o.y;
            }
            rot() {
                if (--this.foodToMake < 0) {
                    util.remove(foodSpawners, foodSpawners.indexOf(this));
                    foodSpawners.push(new FoodSpawner());
                }
            }
        }
        foodSpawners.push(new FoodSpawner());
        foodSpawners.push(new FoodSpawner());
        foodSpawners.push(new FoodSpawner());
        foodSpawners.push(new FoodSpawner());
        const makeGroupedFood = () => {
            let spawner = foodSpawners[ran.irandom(foodSpawners.length - 1)],
                bubble = ran.gaussRing(spawner.size, .25);
            placeNewFood({
                x: spawner.x + bubble.x,
                y: spawner.y + bubble.y
            }, -1, 0);
            spawner.rot();
        };
        const makeDistributedFood = () => {
            let spot = {};
            do spot = room.gaussRing(.5, 2);
            while (room.isInNorm(spot));
            placeNewFood(spot, .01 * room.width, 0);
        };
        const makeCornerFood = () => {
            let spot = {};
            do spot = room.gaussInverse(5);
            while (room.isInNorm(spot));
            placeNewFood(spot, .05 * room.width, 0);
        };
        const makeNestFood = () => {
            let spot = room.randomType("nest");
            placeNewFood(spot, .01 * room.width, 3, true);
        };
        return () => {
            let census = {
                    [0]: 0, // Egg
                    [1]: 0, // Square
                    [2]: 0, // Triangle
                    [3]: 0, // Pentagon
                    [4]: 0, // Hexagon
                    [5]: 0, // Heptagon
                    [6]: 0, // Octagon
                    [7]: 0, // Nonagon
                    [8]: 0, // Decagon
                    [9]: 0, // ?
                    [10]: 0, // ?
                    tank: 0,
                    sum: 0
                },
                censusNest = {
                    [0]: 0, // Egg
                    [1]: 0, // Square
                    [2]: 0, // Triangle
                    [3]: 0, // Pentagon
                    [4]: 0, // Hexagon
                    [5]: 0, // Heptagon
                    [6]: 0, // Octagon
                    [7]: 0, // Nonagon
                    [8]: 0, // Decagon
                    [9]: 0, // ?
                    [10]: 0, // ?
                    sum: 0
                };
            food = entities.map(instance => {
                try {
                    if (census.tank < 10) census.tank++;
                    else if (instance.foodLevel > -1) {
                        if (room.isIn("nest", {x: instance.x, y: instance.y})) {
                            censusNest.sum++;
                            censusNest[instance.foodLevel]++;
                        } else {
                            census.sum++;
                            census[instance.foodLevel]++;
                        }
                        return instance;
                    }
                } catch (e) {
                    util.error(instance.label);
                    util.error(e);
                    instance.kill();
                }
            }).filter(e => e);
            let maxFood = 1 + room.maxFood + 15 * census.tank,
                maxNestFood = 1 + room.maxFood * room.nestFoodAmount,
                foodAmount = census.sum,
                nestFoodAmount = censusNest.sum;
            for (let spawner of foodSpawners)
                if (ran.chance(1 - foodAmount / maxFood)) spawner.rot();
            while (ran.chance(.8 * (1 - foodAmount * foodAmount / maxFood / maxFood))) switch (ran.chooseChance(10, 2, 1)) {
                case 0:
                    makeGroupedFood();
                    break;
                case 1:
                    makeDistributedFood();
                    break;
                case 2:
                    makeCornerFood();
                    break;
            }
            while (ran.chance(.5 * (1 - nestFoodAmount * nestFoodAmount / maxNestFood / maxNestFood))) makeNestFood();
            if (!food.length) return 0;
            for (let i = Math.ceil(.01 * food.length); i > 0; i--) {
                let o = food[ran.irandom(food.length - 1)];
                if (o.foodLevel < 10) {
                    let overflow;
                    for (let j = 0; j < 6; j++) {
                        overflow = 10;
                        o = nearest(food, o, i => i === o);
                        if (!overflow) continue;
                        let proportions = c.FOOD,
                            cens = census,
                            amount = foodAmount;
                        if (room.isIn("nest", o)) {
                            proportions = c.FOOD_NEST;
                            cens = censusNest;
                            amount = nestFoodAmount;
                        }
                        o.foodCountup += Math.ceil(Math.abs(ran.gauss(0, 10)));
                        let lvl = o.foodLevel + 1;
                        while (o.foodCountup >= 100 * lvl) {
                            o.foodCountup -= 100 * lvl;
                            if (ran.chance(1 - cens[lvl] / amount / proportions[lvl])) o.define(getFoodClass(lvl));
                        }
                    }
                }
            }
        };
    })();
    return () => {
        if (!room.modelMode) {
            makeNPCs();
            makeFood();
        }
        for (let o of entities) {
            if (o.shield.max) o.shield.regenerate();
            if (o.health.amount) o.health.regenerate(o.shield.max && o.shield.max === o.shield.amount);
        }
    };
})();
const speedCheckLoop = (() => {
    return () => {
        let activationTime = logs.activation.sum(),
            collideTime = logs.collide.sum(),
            moveTime = logs.entities.sum(),
            playerTime = logs.network.sum(),
            mapTime = logs.minimap.sum(),
            physicsTime = logs.physics.sum(),
            lifeTime = logs.life.sum(),
            selfieTime = logs.selfie.sum(),
            sum = logs.master.record(),
            loops = logs.loops.count(),
            active = logs.entities.count();
        room.fps = (1000 / sum).toFixed(2);
        if (sum > 1000 / room.speed / 30) {
            util.warn(`CPU usage is greater than 100%! CPU Usage: ${(sum * room.speed * 3).toFixed(3)}%.`);
            util.warn(`Loops: ${loops}. Entities: ${entities.length}//${Math.round(active / loops)}. Views: ${views.length}.`);
            util.warn(`Total activation time: ${activationTime}. Total collision time: ${collideTime}. Total cycle time: ${moveTime}.`);
            util.warn(`Total player update time: ${playerTime}. Total lb+minimap processing time: ${mapTime}. Total entity physics calculation time: ${physicsTime}.`);
            util.warn(`Total entity life+thought cycle time: ${lifeTime}. Total entity selfie-taking time: ${selfieTime}. Total time: ${activationTime + collideTime + moveTime + playerTime + mapTime + physicsTime + lifeTime + selfieTime}.`);
        }
    };
})();
const server = http.createServer(app);
const websockets = (() => {
    let socketConfig = {
        server: server
    };
    if (c.servesStatic) server.listen(c.port, () => {
        util.log((new Date()) + ". Joint HTTP+Websocket server turned on. Listening on port " + server.address().port + ".");
    });
    else {
        socketConfig.port = c.port;
        util.log((new Date()) + "Websocket server turned on. Listening on port " + c.port + ".");
    }
    return new WebSocket.Server(socketConfig);
})().on("connection", sockets.connect);

setInterval(abilityLoop, room.cycleSpeed * 7.5);
setInterval(gameLoop, room.cycleSpeed);
setInterval(maintainLoop, 200);
setInterval(speedCheckLoop, 1000);

// Graceful shutdown
if (process.platform === "win32") {
    const rl = require("readline").createInterface({
        input: process.stdin,
        output: process.stdout
    });
    rl.on("SIGINT", () => {
        process.emit("SIGINT");
    });
}
// Forced shutdown
process.on("SIGINT", () => {
    if (room.arenaClosed) {
        util.warn("Force exit induced! Ending process...");
        process.exit();
    } else {
        if (c.enableBot) sendClosed(c.serverName, "Reason: Force Exit", "Arena has been closed by the host.");
        closeArena();
        util.info("Server going down! Warning broadcasted.");
    }
});
if (room.maxBots > 0) setTimeout(() => util.log("Spawned " + room.maxBots + " AI bot" + (room.maxBots > 1 ? "s." : ".")), 350);
if (c.enableBot) {
    const Eris = require("eris");
    let prefix = c.botPrefix,
        prefix2 = c.botPrefix2;
    bot = new Eris(tokens.bot);
    /*moderatorUsers = [
        "115148165128257544", // Hellcat
        "477748686311653376", // Altcat (Hellcat's alt)
        "195742804901625856", // Hellcat's original alt
        "340270483838599168", // Clarise
        "462721019959050240", // The bot itself
        "239162248990294017"  // CX
    ],
    overseerUsers = [
        //"446469522237685776", // wocks man
    ],*/
    let devUsers = [
            "115148165128257544", // Hellcat
            "477748686311653376", // Altcat (Hellcat's alt)
            "195742804901625856", // Hellcat's original alt
            "340270483838599168", // Clarise
            "462721019959050240"  // Arras Controller
        ],
        blockedUsers = [
            //"426117171878297603" // mse
        ],
        playingTag = `Type ${prefix}}help for commands!`,
        status = "online",
        commandsDisabled = false,
        disabledBy = "undefined",
        overrideInterval = room.testingMode,
        alreadyInitialized = false;
    setInterval(() => {
        if (!overrideInterval) {
            playingTag = ran.choose(["Play now at http://woomy-arras.io/", `Type ${ran.choose([prefix, prefix2])}help for ${c.serverName} commands!`, "Join us at https://discord.gg/JrwVT3F"]);
            bot.editStatus(status, {
                name: playingTag,
                type: 0
            });
        }
    }, 4e4);
    bot.on("ready", () => {
        if (!alreadyInitialized) {
            util.log("Discord bot connected and ready to use!");
            editStatusMessage("Online");
            bot.createMessage("691775141918539946", {
                embed: {
                    author: {
                        name: "Server Startup",
                        icon_url: "https://cdn.discordapp.com/avatars/462721019959050240/ee8807bc4fccc425cde794713c9daf54.png?size=256"
                    },
                    color: 0x8ABC3F,
                    fields: [{
                        name: "Server Name",
                        value: c.serverName,
                        inline: true
                    }, {
                        name: "In Testing Mode?",
                        value: room.testingMode ? "Yes" : "No",
                        inline: true
                    }, {
                        name: "Current Time",
                        value: " " + new Date(),
                        inline: false
                    }]
                }
            });
            alreadyInitialized = true;
        } else {
            util.warn("Discord shard has successfully restarted and reconnected to the server.");
            bot.createMessage("464874675999211522", {
                embed: {
                    author: {
                        name: c.serverName,
                        icon_url: "https://cdn.discordapp.com/avatars/462721019959050240/ee8807bc4fccc425cde794713c9daf54.png?size=256"
                    },
                    color: 0xFFFF00,
                    fields: [{
                        name: "Shard Reset",
                        value: "Discord shard has successfully restarted and reconnected to the server.",
                        inline: false
                    }]
                }
            });
        }
    });
    bot.on("messageCreate", msg => {
        let users = clients.filter(socket => socket.player.body != null),
            command = msg.content.split(" ");
        const checkPermission = (sendMessage = true, mode = 0) => {
            let permitted = false;
            // If the user is a developer then just phuckin uhhhhh let them in
            if (devUsers.includes(msg.author.id)) permitted = true;
            else try {
                switch (mode) {
                    case 0: // If the user is an admin
                        //permitted = moderatorUsers.includes(msg.author.id);
                        permitted = msg.member.roles.includes("451853305027756032");
                        break;
                    //case 1: Blank, use 1 to only check for Developers
                    case 2: // If the user is a beta tester or an admin
                        permitted = moderatorUsers.includes("msg.author.id") || msg.member.roles.includes("443842435026780161") || msg.member.roles.includes("729489925426380930");
                        break;
                    case 3: // If the user is an overseer or an admin
                        permitted = msg.member.roles.includes("728594979831939083") || msg.member.roles.includes("451853305027756032");
                        break;
                    case 4: // If the user is a world record manager, overseer, or admin
                        permitted = msg.member.roles.includes("503319826241159178") || msg.member.roles.includes("728594979831939083") || msg.member.roles.includes("451853305027756032");
                        break;
                }
            } catch (e) {
                util.warn(msg.author.username + " attempted to use a bot command in a DM.");
            }
            if (sendMessage && !permitted) bot.createMessage(msg.channel.id, {
                embed: {
                    author: {
                        name: "Arras.io Controller (" + c.serverName + ")",
                        icon_url: "https://cdn.discordapp.com/avatars/462721019959050240/ee8807bc4fccc425cde794713c9daf54.png?size=256"
                    },
                    color: 0xFF0000,
                    fields: [{
                        name: "Warning",
                        value: "You are not permitted to perform this action.",
                        inline: false
                    }]
                }
            });
            return permitted;
        };
        const sendDisabled = header => bot.createMessage(msg.channel.id, {
            embed: {
                author: {
                    name: header + " (" + c.serverName + ")",
                    icon_url: "https://cdn.discordapp.com/avatars/462721019959050240/ee8807bc4fccc425cde794713c9daf54.png?size=256"
                },
                color: 0xFF0000,
                fields: [{
                    name: "Warning",
                    value: `All commands have currently been disabled by ${disabledBy}.`,
                    inline: false
                }]
            }
        });
        const sendInvalidID = (header, id) => bot.createMessage(msg.channel.id, {
            embed: {
                author: {
                    name: header + " (" + c.serverName + ")",
                    icon_url: "https://cdn.discordapp.com/avatars/462721019959050240/ee8807bc4fccc425cde794713c9daf54.png?size=256"
                },
                color: 0xFFFF00,
                fields: [{
                    name: "Error",
                    value: `Player ID ${id} was not found.`,
                    inline: false
                }]
            }
        });
        const sendNormal = (header, text, type, color) => bot.createMessage(msg.channel.id, {
            embed: {
                author: {
                    name: header + " (" + c.serverName + ")",
                    icon_url: "https://cdn.discordapp.com/avatars/462721019959050240/ee8807bc4fccc425cde794713c9daf54.png?size=256"
                },
                color: color,
                fields: [{
                    name: type,
                    value: text,
                    inline: false
                }]
            }
        });
        try {
            // Do nothing except in #bot-commands; only for normal players
            if ((msg.content.startsWith(prefix) || msg.content.startsWith(prefix2)) && msg.content.length > 1 && !checkPermission(false, 1) && !checkPermission(false, 4) && msg.channel.id !== "442850431891275786") return;/* bot.createMessage(msg.channel.id, {
                embed: {
                    author: {
                        name: "Arras.io Controller (" + c.serverName + ")",
                        icon_url: "https://cdn.discordapp.com/avatars/462721019959050240/ee8807bc4fccc425cde794713c9daf54.png?size=256"
                    },
                    color: 0xFF0000,
                    fields: [{
                        name: "Warning",
                        value: `You are not permitted to run commands outside of the ${msg.channel.name && msg.channel.guild.id === "442747837403627530" ? "<#442850431891275786>" : "#bot-commands"} channel.`,
                        inline: false
                    }]
                }
            });*/
            if (blockedUsers.includes(msg.author.id)) return util.warn(msg.author.username + " tried to use a command, but is blocked from doing so.");
            switch (command[0].toLowerCase()) {
                case prefix + "help": // Displays commands available to non-beta-besters
                case prefix2 + "help":
                    {
                        if (commandsDisabled) return sendDisabled("Normal Commands");
                        bot.createMessage(msg.channel.id, {
                            embed: {
                                author: {
                                    name: "Normal Commands (" + c.serverName + ")",
                                    icon_url: "https://cdn.discordapp.com/avatars/462721019959050240/ee8807bc4fccc425cde794713c9daf54.png?size=256"
                                },
                                color: 0x8ABC3F,
                                fields: [{
                                    name: "Prefixes for this server:",
                                    value: `${prefix2} and ${prefix}`,
                                    inline: false
                                }, {
                                    name: "help",
                                    value: `Displays this message.`,
                                    inline: false
                                }, {
                                    name: "advhelp",
                                    value: "Lists commands only available to Developers and Administrators.",
                                    inline: false
                                }, {
                                    name: "prefixhelp",
                                    value: "Lists command prefixes that correspond with each server (Alias: ph).",
                                    inline: false
                                }, {
                                    name: "link",
                                    value: "Displays the link to the server.",
                                    inline: false
                                }, {
                                    name: "playerlist",
                                    value: "Displays a list of all players and their IDs (Alias: pl).",
                                    inline: false
                                }, {
                                    name: "botlist",
                                    value: "Displays a list of all bots and their IDs (Alias: bl).",
                                    inline: false
                                }, {
                                    name: "broadcast [message]",
                                    value: "Broadcast a message to all players (Alias: br).",
                                    inline: false
                                }, {
                                    name: "directmessage [playerID] [message]",
                                    value: "Broadcast a message to a specified player (Alias: dm).",
                                    inline: false
                                }, {
                                    name: "uptime",
                                    value: "Displays how long the server has been online (Alias: ut).",
                                    inline: false
                                }, {
                                    name: "restarttime",
                                    value: "Displays how long until the server restarts (Alias: rt).",
                                    inline: false
                                }, {
                                    name: "search [searchType] [query]",
                                    value: "Makes the bot send a playerlist/botlist esque list of specified entities, with info on naming, score, and id. Put the query in square brackets if you are using raw numbers or booleans (Alias: s).",
                                    inline: false
                                }, {
                                    name: "guninfo [playerId] [gunNumber (optional)]",
                                    value: "Makes the bot send out a number of guns if the gunNumber is blank, and gives out info on the gun if it isn't blank (Alias: g).",
                                    inline: false
                                }, {
                                    name: "k",
                                    value: "Makes the bot say k.",
                                    inline: false
                                }]
                            }
                        });
                    }
                    break;
                case prefix + "advhelp": // Displays commands available to Developers and Administrators
                case prefix2 + "advhelp":
                    {
                        if (commandsDisabled) return sendDisabled("Developer Commands");
                        bot.createMessage(msg.channel.id, {
                            embed: {
                                author: {
                                    name: "Developer Commands (" + c.serverName + ")",
                                    icon_url: "https://cdn.discordapp.com/avatars/462721019959050240/ee8807bc4fccc425cde794713c9daf54.png?size=256"
                                },
                                color: 0x8ABC3F,
                                fields: [{
                                    name: "Prefixes for this server:",
                                    value: `${prefix2} and ${prefix}`,
                                    inline: false
                                }, {
                                    name: "Notice",
                                    value: "None of these commands will be usable by normal players; only the Developers or Administrators may use them.",
                                    inline: false
                                }, {
                                    name: "kill [group or playerID]",
                                    value: "Kill all of a specified entity group, or a player.",
                                    inline: false
                                }, {
                                    name: "setstat [playerID] [statName] [value]",
                                    value: "Set the value of a specified stat.",
                                    inline: false
                                }, {
                                    name: "settank [playerID] [exportName]",
                                    value: "Define a player's tank.",
                                    inline: false
                                }, {
                                    name: "setsize [playerID] [size]",
                                    value: "Set a player's size.",
                                    inline: false
                                }, {
                                    name: "setscore [playerID] [score]",
                                    value: "Set a player's score.",
                                    inline: false
                                }, {
                                    name: "restore [playerID] [score]",
                                    value: "Restores a player's score.",
                                    inline: false
                                }, {
                                    name: "teleport [playerID] [x] [y]",
                                    value: "Teleport a player to a specified X,Y position (Alias: tp).",
                                    inline: false
                                }, {
                                    name: "setfov [playerID] [fov]",
                                    value: "Sets a player's FOV.",
                                    inline: false
                                }, {
                                    name: "setentity [playerID] [exportName]",
                                    value: "Sets the entity spawned by the F key.\n",
                                    inline: false
                                }, {
                                    name: "setgodmode [playerID]",
                                    value: "Enable or disable godmode for a specified player.",
                                    inline: false
                                }, {
                                    name: "setpassive [playerID]",
                                    value: "Enable or disable passive mode for a specified player.",
                                    inline: false
                                }, {
                                    name: "rainbowspeed [playerID] [speed]",
                                    value: "Sets the speed of the rainbow effect for a player.",
                                    inline: false
                                }, {
                                    name: "multibox [playerID] [entityAmount]",
                                    value: "Allows a player to control a specified amount of entities; they will mirror the player's actions (Aliases: mb, setcontrol).",
                                    inline: false
                                }, {
                                    name: "kick [playerID] [reason (optional)]",
                                    value: "Kicks a specified player from the server.",
                                    inline: false
                                }, {
                                    name: "ban [playerID] [reason (optional)]",
                                    value: "Bans a specified player for the game session.",
                                    inline: false
                                }, {
                                    name: "unban [clientID]",
                                    value: "Unbans a specified IP.",
                                    inline: false
                                }, {
                                    name: "botamount [amount]",
                                    value: "Changes the maximum number of bots that can be on the map.",
                                    inline: false
                                }, {
                                    name: "closearena",
                                    value: "Closes the arena (Alias: exit).",
                                    inline: false
                                }, {
                                    name: "setstatus [status]",
                                    value: "Sets the bot's status.",
                                    inline: false
                                }, {
                                    name: "playingtag [tag]",
                                    value: "Sets the bot's playing tag.",
                                    inline: false
                                }, {
                                    name: "togglecommands",
                                    value: "Enables or disables use of all commands.",
                                    inline: false
                                }, {
                                    name: "disco [numberID or Reset]",
                                    value: "Colors regions of the map randomized colors or a specific color of choice.",
                                    inline: false
                                }, {
                                    name: "message [channelID] [message]",
                                    value: "Sends a message to a channel of choice (alias: msg).",
                                    inline: false
                                }, {
                                    name: "push [tankExport] [Tier - 1] [tankUpgradeExport]",
                                    value: "Makes one tank upgrade into another.",
                                    inline: false
                                }, {
                                    name: "tpt [playerID 1] [playerID 2]",
                                    value: "Teleport a player to another player.",
                                    inline: false
                                }, {
                                    name: "manualOffset [seed (optional)]",
                                    value: "Mixes up tank upgrades based off of a randomized seed (alias: mo).",
                                    inline: false
                                }, {
                                    name: "eval [string]",
                                    value: "Makes the bot run specified code.",
                                    inline: false
                                }, {
                                    name: "advancedeval [string]",
                                    value: "Makes the bot run specified code, but with more info (alias: ae).",
                                    inline: false
                                }, {
                                    name: "globaleval [string]",
                                    value: "Makes the bot run specified code across all servers (alias: ge).",
                                    inline: false
                                }, {
                                    name: "colorbroadcast [color] [message]",
                                    value: "Broadcast a colorized message to all players (Alias: cb).",
                                    inline: false
                                }/*, {
                                    name: "reloadconfig",
                                    value: "Reloads the configurations file associated with this server (alias: rc).",
                                    inline: false
                                }*/]
                            }
                        });
                    }
                    break;
                case prefix + "ph": // Lists command prefixes
                case prefix + "prefixhelp":
                case prefix2 + "ph":
                case prefix2 + "prefixhelp":
                    {
                        if (commandsDisabled) return sendDisabled("Prefix Help");
                        bot.createMessage(msg.channel.id, {
                            embed: {
                                author: {
                                    name: "Prefix Help (" + c.serverName + ")",
                                    icon_url: "https://cdn.discordapp.com/avatars/462721019959050240/ee8807bc4fccc425cde794713c9daf54.png?size=256"
                                },
                                color: 0x8ABC3F,
                                fields: [{
                                    name: "Free For All",
                                    value: "fa! or +",
                                    inline: false
                                }, {
                                    name: "4TDM",
                                    value: "4t! or &",
                                    inline: false
                                }, {
                                    name: "2TDM",
                                    value: "2t! or ;",
                                    inline: false
                                }, {
                                    name: "2TDM Domination",
                                    value: "2d! or _",
                                    inline: false
                                }, {
                                    name: "Portal Domination",
                                    value: "pd! or .",
                                    inline: false
                                }, {
                                    name: "4TDM Maze",
                                    value: "4m! or %",
                                    inline: false
                                }, {
                                    name: "Boss Rush",
                                    value: "bo! or =",
                                    inline: false
                                }, {
                                    name: "Developer Server",
                                    value: "ds! or $",
                                    inline: false
                                }]
                            }
                        });
                    }
                    break;
                case prefix + "pl": // Displays a list of all living players in the game
                case prefix + "playerlist":
                case prefix2 + "pl":
                case prefix2 + "playerlist":
                    {
                        if (commandsDisabled) return sendDisabled("Playerlist");
                        if (!users.length) return sendNormal("Playerlist", "No players are in the server.", "Info", 0x277ECD);
                        let list = [];
                        for (let socket of users) {
                            let body = socket.player.body;
                            if (!body.stealthMode) list.push({
                                name: trimName(body.name) + " - " + body.index,
                                value: body.id + " - " + body.label + " (" + body.skill.score + ")",
                                inline: false
                            });
                        }
                        bot.createMessage(msg.channel.id, {
                            embed: {
                                author: {
                                    name: "Playerlist (" + c.serverName + "): " + players.length + " Players",
                                    icon_url: "https://cdn.discordapp.com/avatars/462721019959050240/ee8807bc4fccc425cde794713c9daf54.png?size=256"
                                },
                                color: 0x8ABC3F,
                                fields: JSON.parse(JSON.stringify(list))
                            }
                        });
                    }
                    break;
                case prefix + "bl": // Displays a list of all bots in the game
                case prefix + "botlist":
                case prefix2 + "bl":
                case prefix2 + "botlist":
                    {
                        if (commandsDisabled) return sendDisabled("Botlist");
                        if (!bots.length) return sendNormal("Botlist", "No bots are in the server.", "Info", 0x277ECD);
                        let list = [];
                        for (let body of bots) list.push({
                            name: trimName(body.name),
                            value: body.id + " - " + body.label + " (" + body.skill.score + ")",
                            inline: false
                        });
                        bot.createMessage(msg.channel.id, {
                            embed: {
                                author: {
                                    name: "Botlist (" + c.serverName + "): " + bots.length + " Bots",
                                    icon_url: "https://cdn.discordapp.com/avatars/462721019959050240/ee8807bc4fccc425cde794713c9daf54.png?size=256"
                                },
                                color: 0x8ABC3F,
                                fields: JSON.parse(JSON.stringify(list))
                            }
                        });
                    }
                    break;
                case prefix + "kick": // Kicks a specified player
                case prefix2 + "kick":
                    {
                        if (commandsDisabled) return sendDisabled("Kick");
                        if (!checkPermission(true, 3)) return;
                        let id = +command[1],
                            reason = command.slice(2, command.length).join(" "),
                            invalid = true;
                        if (typeof id !== "number") return sendNormal("Kick", "Please specify a valid player ID.", "Error", 0xFFFF00);
                        let body = getEntity(id);
                        if (body == null) return sendInvalidID("Kick", id);
                        for (let socket of users)
                            if (socket.player.body.id === body.id) {
                                socket.talk("P", msg.author.username + " has kicked you from the server. Reason: " + (reason || "Unspecified."));
                                sendNormal("Kick", "Kicked " + trimName(body.name) + " from the server. Reason: " + (reason || "Unspecified."), "Info", 0x277ECD);
                                socket.kick(trimName(body.name) + " was kicked by " + msg.author.username + ". Reason: " + (reason || "Unspecified."));
                                body.miscIdentifier = "No Death Log";
                                body.kill();
                                invalid = false;
                            }
                        if (invalid) sendNormal("Kick", "This command only works on players.", "Error", 0xFFFF00);
                    }
                    break;
                case prefix + "br": // Sends a specified message to all players
                case prefix + "broadcast":
                case prefix2 + "br":
                case prefix2 + "broadcast":
                    {
                        if (commandsDisabled) return sendDisabled("Broadcast");
                        let message = command.slice(1, command.length).join(" ");
                        if (!message) return sendNormal("Broadcast", "Please specify a message to broadcast.", "Error", 0xFF0000);
                        sockets.broadcast(msg.author.username + " says: " + message);
                        sendNormal("Broadcast", "Broadcasting your message to all players.", "Info", 0x8ABC3F);
                    }
                    break;
                case prefix + "cb": // Sends a specified colored message to all players
                case prefix + "colorbroadcast":
                case prefix2 + "cb":
                case prefix2 + "colorbroadcast":
                    {
                        if (commandsDisabled) return sendDisabled("Colored Broadcast");
                        if (!checkPermission(true, 2) && !checkPermission(true, 3)) return;
                        let color = command[1],
                            message = command.slice(2, command.length).join(" ");
                        if (!color) return sendNormal("Colored Broadcast", "Please specify a color for this broadcast.", "Error", 0xFF0000);
                        if (color === "rainbow" && !checkPermission(false)) return sendNormal("Colored Broadcast", "You are not permitted to use rainbow broadcasts.", "Error", 0xFF0000);
                        if (!message) return sendNormal("Colored Broadcast", "Please specify a message to broadcast.", "Error", 0xFF0000);
                        sockets.broadcast((checkPermission(false, 1) ? "" : msg.author.username + " says: ") + message, color !== "rainbow" && !color.includes("#") ? "#" + color : color);
                        sendNormal("Colored Broadcast", "Broadcasting your colorized message to all players.", "Info", 0x8ABC3F);
                    }
                    break;
                case prefix + "kill": // Kills a specified player
                case prefix2 + "kill":
                    {
                        if (commandsDisabled) return sendDisabled("Kill");
                        if (!checkPermission(true, 3)) return;
                        let id = command[1],
                            errorMessage = "Invalid ID or entity group argument! The following are valid entity groups: `players`, `food`, `allbutplayers`, `obstacles`, `mazewalls`, `all`, `bots`, `bosses`, `bullets`, `drones`, and `tanks`.";
                        if (!id) return sendNormal("Kill", errorMessage, "Error", 0xFFFF00);
                        if (!isNaN(id)) {
                            let body = getEntity(+id);
                            if (body == null) return sendInvalidID("Kill", id);
                            body.kill();
                            sendNormal("Kill", "Killed " + trimName(body.name) + ".", "Info", 0x277ECD);
                        } else if (isNaN(id)) {
                            let count = 0,
                                message = null,
                                entitiesToKill = null;
                            switch (command[1].toLowerCase()) {
                                case "players":
                                    entitiesToKill = users;
                                    message = "players";
                                    break;
                                case "all":
                                    entitiesToKill = entities;
                                    message = "entities";
                                    break;
                                case "bots":
                                    entitiesToKill = bots;
                                    message = "bots";
                                    break;
                                case "food":
                                    entitiesToKill = entities.filter(o => o.type === "food");
                                    message = "food entities";
                                    break;
                                case "bullets":
                                    entitiesToKill = entities.filter(o => o.type === "bullet");
                                    message = "bullet entities";
                                    break;
                                case "drones":
                                    entitiesToKill = entities.filter(o => o.type === "drone");
                                    message = "drone entities";
                                    break;
                                case "crashers":
                                    entitiesToKill = entities.filter(o => o.type === "crasher");
                                    message = "crashers";
                                    break;
                                case "traps":
                                    entitiesToKill = entities.filter(o => o.type === "trap");
                                    message = "trap entities";
                                    break;
                                case "tanks":
                                    entitiesToKill = entities.filter(o => o.type === "tank");
                                    message = "tank entities";
                                    break;
                                case "allbutplayers":
                                    entitiesToKill = entities.filter(o => o.type !== "tank");
                                    message = "non-player entities";
                                    break;
                                case "obstacles":
                                    entitiesToKill = entities.filter(o => o.type === "wall");
                                    message = "obstacles";
                                    break;
                                case "mazewalls":
                                    entitiesToKill = entities.filter(o => o.type === "mazeWall");
                                    message = "maze walls";
                                    break;
                                case "bosses":
                                    entitiesToKill = entities.filter(o => o.type === "miniboss");
                                    message = "bosses";
                                    break;
                            }
                            if (message == null) return sendNormal("Kill", errorMessage, "Error", 0xFFFF00);
                            if (command[1].toLowerCase() === "players") {
                                for (let player of entitiesToKill) {
                                    player.body.kill();
                                    count++;
                                }
                            } else {
                                for (let body of entitiesToKill) {
                                    body.kill();
                                    count++;
                                }
                            }
                            sendNormal("Kill", "Killed " + count + " " + message + ".", "Info", 0x277ECD);
                        }
                    }
                    break;
                case prefix + "setstat": // Set the upgrade stats of a specified player
                case prefix2 + "setstat":
                    {
                        if (commandsDisabled) return sendDisabled("Set Stat");
                        if (!checkPermission(true, 1)) return;
                        let id = +command[1],
                            stat = command[2],
                            val = +command[3],
                            errorMessage = "Invalid stat argument! The following are valid stats: `weapon_speed`, `weapon_reload`, `move_speed`, `max_health`, `body_damage`, and `weapon_damage`.";
                        if (typeof id !== "number") return sendNormal("Set Stat", "Please specify a valid player ID.", "Error", 0xFFFF00);
                        if (typeof stat !== "string") return sendNormal("Set Stat", errorMessage, "Error", 0xFFFF00);
                        if (typeof val !== "number") return sendNormal("Set Stat", "Invalid stat value argument.", "Error", 0xFFFF00);
                        let body = getEntity(id);
                        if (body == null) return sendInvalidID("Set Stat", id);
                        switch (stat.toLowerCase()) {
                            case "weapon_speed":
                                body.skill.spd = val;
                                break;
                            case "weapon_reload":
                                body.skill.rld = val;
                                break;
                            case "move_speed":
                                body.SPEED = val;
                                body.ACCELERATION = val / 3;
                                body.refreshBodyAttributes();
                                break;
                            case "max_health":
                                body.HEALTH = val;
                                body.refreshBodyAttributes();
                                break;
                            case "body_damage":
                                body.DAMAGE = val;
                                body.refreshBodyAttributes();
                                break;
                            case "weapon_damage":
                                body.skill.dam = val;
                                break;
                            default:
                                return sendNormal("Set Stat", errorMessage, "Error", 0xFFFF00);
                        }
                        sendNormal("Set Stat", "Set " + trimName(body.name) + "'s " + stat + " stat to " + val + ".", "Info", 0x277ECD);
                    }
                    break;
                case prefix + "settank": // Sets the tank of a specified player
                case prefix2 + "settank":
                    {
                        if (commandsDisabled) return sendDisabled("Set Tank");
                        if (!checkPermission(true, 3)) return;
                        let id = +command[1],
                            tank = command[2];
                        if (typeof id !== "number") return sendNormal("Set Tank", "Please specify a valid player ID.", "Error", 0xFFFF00);
                        if (typeof tank !== "string") return sendNormal("Set Tank", "Please specify a valid tank export.", "Error", 0xFFFF00);
                        let body = getEntity(id);
                        if (body == null) return sendInvalidID("Set Tank", id);
                        body.upgradeTank(Class[tank]);
                        sendNormal("Set Tank", "Set " + trimName(body.name) + "'s tank to " + tank + ".", "Info", 0x277ECD);
                    }
                    break;
                case prefix + "setsize": // Sets the size of a specified player
                case prefix2 + "setsize":
                    {
                        if (commandsDisabled) return sendDisabled("Set Size");
                        if (!checkPermission(true, 3)) return;
                        let id = +command[1],
                            size = +command[2];
                        if (typeof id !== "number") return sendNormal("Set Size", "Please specify a valid player ID.", "Error", 0xFFFF00);
                        if (typeof size !== "number" || size <= 0) return sendNormal("Set Size", "Please specify a valid size value.", "Error", 0xFFFF00);
                        let body = getEntity(id);
                        if (body == null) return sendInvalidID("Set Size", id);
                        body.SIZE = size;
                        sendNormal("Set Size", "Set " + trimName(body.name) + "'s size to " + size + ".", "Info", 0x277ECD);
                    }
                    break;
                case prefix + "setfov": // Sets the field of view of a specified player
                case prefix2 + "setfov":
                    {
                        if (commandsDisabled) return sendDisabled("Set FoV");
                        if (!checkPermission(true, 3)) return;
                        let id = +command[1],
                            fov = +command[2];
                        if (typeof id !== "number") return sendNormal("Set FoV", "Please specify a valid player ID.", "Error", 0xFFFF00);
                        if (typeof fov !== "number") return sendNormal("Set FoV", "Please specify a valid FoV value.", "Error", 0xFFFF00);
                        let body = getEntity(id);
                        if (body == null) return sendInvalidID("Set FoV", id);
                        body.FOV = fov;
                        body.refreshFOV();
                        sendNormal("Set FoV", "Set " + trimName(body.name) + "'s FoV to " + fov + ".", "Info", 0x277ECD);
                    }
                    break;
                case prefix + "setscore": // Sets the score of a specified player
                case prefix2 + "setscore":
                    {
                        if (commandsDisabled) return sendDisabled("Set Score");
                        if (!checkPermission(true, 3)) return;
                        let id = +command[1],
                            score = +command[2];
                        if (typeof id !== "number") return sendNormal("Set Score", "Please specify a valid player ID.", "Error", 0xFFFF00);
                        if (typeof score !== "number") return sendNormal("Set Score", "Please specify a valid score value.", "Error", 0xFFFF00);
                        let body = getEntity(id);
                        if (body == null) return sendInvalidID("Set Score", id);
                        body.skill.score = score;
                        sendNormal("Set Score", "Set " + trimName(body.name) + "'s score to " + score + ".", "Info", 0x277ECD);
                    }
                    break;
                case prefix + "restore": // Takes a score and adds it to a specified player's current score
                case prefix2 + "restore":
                    {
                        if (commandsDisabled) return sendDisabled("Restore Score");
                        if (!checkPermission(true, 4)) return;
                        let id = +command[1],
                            score = +command[2];
                        if (typeof id !== "number") return sendNormal("Restore Score", "Please specify a valid player ID.", "Error", 0xFFFF00);
                        if (typeof score !== "number") return sendNormal("Restore Score", "Please specify a valid score value.", "Error", 0xFFFF00);
                        let body = getEntity(id);
                        if (body == null) return sendInvalidID("Restore Score", id);
                        body.skill.score += score;
                        sendNormal("Restore Score", "Restored " + trimName(body.name) + "'s score to " + body.skill.score + ".", "Info", 0x277ECD);
                    }
                    break;
                case prefix + "tp": // Teleports a specified player to a specified location
                case prefix + "teleport":
                case prefix2 + "tp":
                case prefix2 + "teleport":
                    {
                        if (commandsDisabled) return sendDisabled("Teleport");
                        if (!checkPermission(true, 3)) return;
                        let id = +command[1],
                            x = +command[2],
                            y = +command[3];
                        if (typeof id !== "number") return sendNormal("Teleport", "Please specify a valid player ID.", "Error", 0xFFFF00);
                        if (typeof x !== "number" || typeof y !== "number") return sendNormal("Set Score", "Please specify a valid X,Y position.", "Error", 0xFFFF00);
                        let body = getEntity(id);
                        if (body == null) return sendInvalidID("Teleport", id);
                        body.x = x;
                        body.y = y;
                        sendNormal("Teleport", "Teleported " + trimName(body.name) + " to (" + x + ", " + y + ").", "Info", 0x277ECD);
                    }
                    break;
                case prefix + "setentity": // Sets what the F key spawns for a specified player
                case prefix2 + "setentity":
                    {
                        if (commandsDisabled) return sendDisabled("Set F Key Entity");
                        if (!checkPermission(true, 1)) return;
                        let id = +command[1],
                            entity = command[2];
                        if (typeof id !== "number") return sendNormal("Set F Key Entity", "Please specify a valid player ID.", "Error", 0xFFFF00);
                        if (!entity || !isNaN(entity)) return sendNormal("Set F Key Entity", "Please specify a valid tank export.", "Error", 0xFFFF00);
                        let body = getEntity(id);
                        if (body == null) return sendInvalidID("Set F Key Entity", id);
                        body.keyFEntity = entity;
                        sendNormal("Set F Key Entity", "Set " + trimName(body.name) + "'s F key entity to " + entity + ".", "Info", 0x277ECD);
                    }
                    break;
                case prefix + "botamount": // Set how many bots can spawn in the server
                case prefix2 + "botamount":
                    {
                        if (commandsDisabled) return sendDisabled("Set Bot Amount");
                        if (!checkPermission(true, 1)) return;
                        let amount = command[1];
                        if (!amount || isNaN(amount)) return sendNormal("Set Bot Amount", "Please specify a valid bot amount.", "Error", 0xFFFF00);
                        room.maxBots = amount;
                        sendNormal("Set Bot Amount", "Set the maximum bot amount to " + amount + ".", "Info", 0x277ECD);
                    }
                    break;
                case prefix + "k": // Sends variants of "k"
                case prefix2 + "k":
                    {
                        bot.createMessage(msg.channel.id, [
                            "k",
                            "***__K__***",
                            ":regional_indicator_k:",
                            "<:arrask:479873599868633089>",
                            "|/\n|\\\\",
                            "<:arrask2:479873599834947587>",
                            "K",
                            "\u029E",
                            "\u24DA"
                        ][Math.floor(9 * Math.random())]);
                    }
                    break;
                case prefix + "link": // Sends a link to the server
                case prefix2 + "link":
                    {
                        sendNormal("Link", "http://woomy-arras.io/", "Here is the link to join. If you are looking to join a specific server, hover your mouse over the server name in the start menu and scroll to find it.", 0x8ABC3F);
                    }
                    break;
                case prefix + "setstatus": // Sets the bot's online status
                case prefix2 + "setstatus":
                    {
                        if (commandsDisabled) return sendDisabled("Set Bot Status");
                        if (!checkPermission(true, 1)) return;
                        status = command[1];
                        if (status !== "online" && status !== "dnd" && status !== "idle" && status !== "invisible") sendNormal("Set Bot Status", "Invalid online status! Valid statuses are `online`, `idle`, `dnd` and `invisible`.", "Error", 0xFFFF00);
                        bot.editStatus(status, {
                            name: playingTag,
                            type: 0
                        });
                        sendNormal("Set Bot Status", "My online status has been set to " + status + ".", "Info", 0x277ECD);
                    }
                    break;
                case prefix + "ut": // Displays how long the server has been online for
                case prefix + "uptime":
                case prefix2 + "ut":
                case prefix2 + "uptime":
                    {
                        if (commandsDisabled) return sendDisabled("Uptime");
                        const formatTime = t => {
                            let parse = w => (w < 10 ? "0" : "") + w,
                                h = Math.floor(t / 3600),
                                m = Math.floor(t % 3600 / 60),
                                s = Math.floor(t % 60);
                            return parse(h) + ":" + parse(m) + ":" + parse(s);
                        };
                        sendNormal("Uptime", "`" + formatTime(process.uptime()) + "`", "Server Uptime:", 0x8ABC3F);
                    }
                    break;
                case prefix + "playingtag": // Sets the bot's playing status
                case prefix2 + "playingtag":
                    {
                        if (commandsDisabled) return sendDisabled("Set Playing Status");
                        if (!checkPermission(true, 1)) return;
                        let text = command.slice(1, command.length).join(" ");
                        playingTag = !text ? "Type +help for commands!" : text;
                        overrideInterval = !text ? false : true;
                        bot.editStatus(status, {
                            name: playingTag,
                            type: 0
                        });
                        sendNormal("Set Playing Status", "My playing tag has been set to `" + playingTag + "`.", "Info", 0x277ECD);
                    }
                    break;
                case prefix + "setgodmode": // Enables or disables god-mode for a specified player
                case prefix2 + "setgodmode":
                    {
                        if (commandsDisabled) return sendDisabled("Set God-mode");
                        if (room.arenaClosed) return sendNormal("Set God-mode", "This command cannot be used when the arena is closing.", "Warning", 0xFF0000);
                        if (!checkPermission(true, 1)) return;
                        let id = +command[1];
                        if (typeof id !== "number") return sendNormal("Set God-mode", "Please specify a valid player ID.", "Error", 0xFFFF00);
                        let body = getEntity(id);
                        if (body == null) return sendInvalidID("Set God-mode", id);
                        body.godmode = !body.godmode;
                        for (let o of entities)
                            if (o.master.id === body.id && o.id !== body.id) o.diesToTeamBase = !body.godmode;
                        sendNormal("Set God-mode", (body.godmode ? "En" : "Dis") + "abled god-mode for " + trimName(body.name) + ".", "Info", 0x277ECD);
                    }
                    break;
                case prefix + "setpassive": // Enables or disables passive mode for a specified player
                case prefix2 + "setpassive":
                    {
                        if (commandsDisabled) return sendDisabled("Set Passive Mode");
                        if (room.arenaClosed) return sendNormal("Set Passive Mode", "This command cannot be used when the arena is closing.", "Warning", 0xFF0000);
                        if (!checkPermission(true, 1)) return;
                        let id = +command[1];
                        if (typeof id !== "number") return sendNormal("Set Passive Mode", "Please specify a valid player ID.", "Error", 0xFFFF00);
                        let body = getEntity(id);
                        if (body == null) return sendInvalidID("Set Passive Mode", id);
                        body.passive = !body.passive;
                        for (let o of entities)
                            if (o.master.id === body.id && o.id !== body.id) o.passive = body.passive;
                        sendNormal("Set Passive Mode", (body.passive ? "En" : "Dis") + "abled passive mode for " + trimName(body.name) + ".", "Info", 0x277ECD);
                    }
                    break;
                case prefix + "rainbowspeed": // Sets the speed of rainbow color cycling for a specified player
                case prefix2 + "rainbowspeed":
                    {
                        if (commandsDisabled) return sendDisabled("Set Rainbow Cycle Speed");
                        if (!checkPermission(true, 3)) return;
                        let id = +command[1],
                            rainSpd = +command[2];
                        if (typeof id !== "number") return sendNormal("Set Rainbow Cycle Speed", "Please specify a valid player ID.", "Error", 0xFFFF00);
                        if (!rainSpd || isNaN(rainSpd)) return sendNormal("Set Rainbow Cycle Speed", "Please specify a valid rainbow speed value.", "Error", 0xFFFF00);
                        let body = getEntity(id);
                        if (body == null) return sendInvalidID("Set Rainbow Cycle Speed", id);
                        body.rainbowSpeed = rainSpd;
                        body.toggleRainbow();
                        body.toggleRainbow();
                        sendNormal("Set Rainbow Cycle Speed", "Set" + trimName(body.name) + "'s rainbow cycle speed to " + body.rainbowSpeed + ".", "Info", 0x277ECD);
                    }
                    break;
                case prefix + "togglecommands": // Enable or disable the use of commands
                case prefix2 + "togglecommands":
                    {
                        if (!checkPermission(true, 1)) return;
                        commandsDisabled = !commandsDisabled;
                        disabledBy = msg.author.username;
                        sendNormal("Toggle Commands", "Commands have been " + (commandsDisabled ? "dis" : "en") + "abled.", "Info", 0x277ECD);
                    }
                    break;
                case prefix + "eval": // Runs specified code
                case prefix2 + "eval":
                    {
                        if (commandsDisabled) return sendDisabled("Eval");
                        if (!checkPermission(true, 1)) return;
                        try {
                            let string = command.slice(1, command.length).join(" ");
                            //if (string.includes("`")) string = string.repalce("`", "");
                            sendNormal("Eval", "```js\n" + eval(string) + "\n```", "OUTPUT               \u200b", 0xFF8800);
                        } catch (e) {
                            sendNormal("Eval", "```js\n" + e + "\n```", "OUTPUT               \u200b", 0xFF8800);
                        }
                        util.warn(msg.author.username + " ran the eval command in " + (msg.channel.name ? "the " + msg.channel.name : "a DM") + " channel.");
                    }
                    break;
                case prefix + "ae": // Same as eval, but gives more detailed outputs
                case prefix + "advancedeval":
                case prefix2 + "ae":
                case prefix2 + "advancedeval":
                    {
                        if (commandsDisabled) return sendDisabled("Eval Deluxe");
                        if (!checkPermission(true, 1)) return;
                        let out = null;
                        try {
                            out = eval(command.slice(1, command.length).join(" "));
                        } catch (e) {
                            out = e;
                        }
                        try {
                            let inspect = require("util").inspect;
                            out = inspect(out, {
                                depth: 2,
                                maxArrayLength: 30,
                                breakLength: 120
                            });
                        } catch (e) {
                            out = `[${typeof out}] ${out}`;
                        }
                        sendNormal("Eval Deluxe", "```js\n" + out + "\n```", "OUTPUT               \u200b", 0xFF8800);
                        util.warn(msg.author.username + " ran the advancedeval command in " + (msg.channel.name ? "the " + msg.channel.name : "a DM") + " channel.");
                    }
                    break;
                case prefix + "ge": // Runs eval across all servers
                case prefix + "globaleval":
                case prefix2 + "ge":
                case prefix2 + "globaleval":
                    {
                        if (commandsDisabled) return sendDisabled("Eval");
                        if (!checkPermission(true, 1)) return;
                        let fail = true,
                            string = command.slice(1, command.length).join(" ");
                        try {
                            sendNormal("Global Eval", "```js\n" + eval(string) + "\n```", "OUTPUT\u200b", 0xFF8800);
                            fail = false;
                        } catch (e) {
                            sendNormal("Global Eval", "```js\n" + e + "\n```", "OUTPUT\u200b", 0xFF8800);
                        }
                        if (!fail) {
                            let prefixes = "+_&.%;=";
                            for (let i = 0; i < prefixes.length; i++)
                                if (prefix !== prefixes[i]) setTimeout(() => bot.createMessage("505934246389612554", prefixes[i] + "silenteval " + string), 1000 * i);
                        }
                        util.warn(msg.author.username + " ran the globaleval command in " + (msg.channel.name ? "the " + msg.channel.name : "a DM") + " channel.");
                    }
                    break;
                case prefix + "silenteval": // Runs eval with no logs (mainly for globaleval)
                case prefix2 + "silenteval":
                    {
                        if (commandsDisabled) return sendDisabled("Eval");
                        if (!checkPermission(false, 1)) return;
                        try {
                            let string = command.slice(1, command.length).join(" ");
                            eval(string);
                        } catch (e) {}
                    }
                    break;
                case prefix + "ban": // Bans a specified player
                case prefix2 + "ban":
                    {
                        if (commandsDisabled) return sendDisabled("Ban");
                        if (!checkPermission(true, 3)) return;
                        let id = +command[1],
                            reason = command.slice(2, command.length).join(" "),
                            invalid = true;
                        if (typeof id !== "number") return sendNormal("Ban", "Please specify a valid player ID.", "Error", 0xFFFF00);
                        let body = getEntity(id);
                        if (body == null) return sendInvalidID("Ban", id);
                        for (let socket of users)
                            if (socket.player.body.id === body.id) {
                                socket.talk("P", msg.author.username + " has banned you from the server. Reason: " + (reason || "Unspecified."));
                                sendNormal("Ban", trimName(body.name) + " has been banned. Reason: " + (reason || "Unspecified."), "Info", 0x277ECD);
                                socket.ban(trimName(body.name) + " was banned by " + msg.author.username + "! Reason: " + (reason || "Unspecified."), reason);
                                body.miscIdentifier = "No Death Log";
                                body.kill();
                                invalid = false;
                            }
                        if (invalid) sendNormal("Ban", "This command only works on players.", "Error", 0xFFFF00);
                    }
                    break;
                case prefix + "unban": // Unbans a specified IP
                case prefix2 + "unban":
                    {
                        if (commandsDisabled) return sendDisabled("Unban");
                        if (!checkPermission(true, 3)) return;
                        let ip = command[1],
                            invalid = true;
                        if (!ip) return sendNormal("Unban", "Please specify a valid IP.", "Error", 0xFFFF00);
                        if (bannedIPs[0].includes(ip)) {
                            util.remove(bannedIPs[0], ip);
                            sendNormal("Unban", "The IP " + ip + " is no longer banned.", "Info", 0x277ECD);
                            util.warn("The IP " + ip + " has been unbanned by " + msg.author.username + ".");
                            invalid = false;
                        }
                        if (invalid) sendNormal("Unban", "The IP " + ip + " was not found.", "Error", 0xFFFF00);
                    }
                    break;
                case prefix + "dm": // Send a message to only one player
                case prefix + "directmessage":
                case prefix2 + "dm":
                case prefix2 + "directmessage":
                    {
                        if (commandsDisabled) return sendDisabled("Direct Message");
                        let id = +command[1],
                            message = command.slice(2, command.length).join(" ");
                        if (typeof id !== "number") return sendNormal("Direct Message", "Please specify a valid player ID.", "Error", 0xFFFF00);
                        if (!message) return sendNormal("Direct Message", "Please specify a message to send.", "Error", 0xFFFF00);
                        let body = getEntity(id);
                        if (body == null) return sendInvalidID("Direct Message", id);
                        body.sendMessage(msg.author.username + " says to you: " + message);
                        sendNormal("Direct Message", "Sending your message to " + trimName(body.name) + ".", "Info", 0x277ECD);
                    }
                    break;
                case prefix + "exit": // Closes the arena
                case prefix + "closearena":
                case prefix2 + "exit":
                case prefix2 + "closearena":
                    {
                        if (commandsDisabled) return sendDisabled("Close Arena");
                        if (!checkPermission(true, 1)) return;
                        if (room.arenaClosed) {
                            util.warn(msg.author.username + " induced a force exit.");
                            sendNormal("Close Arena", "Force exit induced! Closing server...", "Warning", 0xFF0000);
                            process.exit();
                        }
                        util.warn("Arena has been closed by " + msg.author.username + ".");
                        if (c.enableBot) sendClosed(c.serverName, "Reason: Force Exit", "Arena has been closed by " + msg.author.username + ".");
                        sendNormal("Close Arena", "Arena Closed: No players can join.", "Warning", 0xFF0000);
                        closeArena();
                    }
                    break;
                case prefix + "mb": // Enables or disables multiboxing
                case prefix + "setcontrol":
                case prefix + "multibox":
                case prefix2 + "mb":
                case prefix2 + "setcontrol":
                case prefix2 + "multibox":
                    {
                        if (commandsDisabled) return sendDisabled("Multibox");
                        if (!checkPermission(true, 1)) return;
                        let id = +command[1],
                            amount = +command[2];
                        if (typeof id !== "number") return sendNormal("Multibox", "Please specify a valid player ID.", "Error", 0xFFFF00);
                        let body = getEntity(id);
                        if (body == null) return sendInvalidID("Multibox", id);
                        if (typeof amount !== "number") return sendNormal("Multibox", "Please specify a valid number of tanks to control.", "Error", 0xFFFF00);
                        for (let socket of users)
                            if (socket.player.body.id === body.id) {
                                if (amount === 0) {
                                    if (!body.multibox.enabled) return sendNormal("Multibox", "Multiboxing is already disabled for " + trimName(body.name) + ".", "Error", 0xFFFF00);
                                    sendNormal("Multibox", "Multiboxing has been disabled for " + trimName(body.name) + ".", "Info", 0x277ECD);
                                    body.multibox.enabled = false;
                                    body.onDead();
                                    return body.onDead = null
                                }
                                sendNormal("Multibox", trimName(body.name) + " is now controlling " + amount + (amount > 1 ? " entities" : " entity") + ".", "Info", 0x277ECD);
                                while (amount-- > 0) {
                                    let controlledBody = new Entity({
                                        x: body.x + Math.random() * 5,
                                        y: body.y - Math.random() * 5
                                    });
                                    if (room.gameMode === "tdm") controlledBody.team = body.team;
                                    else body.team = controlledBody.team = -9;
                                    controlledBody.define(Class.basic);
                                    controlledBody.controllers = [new io_listenToPlayer(body, socket.player)];
                                    controlledBody.invuln = false;
                                    controlledBody.color = body.color;
                                    controlledBody.settings.leaderboardable = false;
                                    body.multibox.controlledTanks.push(controlledBody);
                                }
                                //body.color = 34;
                                body.onDead = () => {
                                    if (body.multibox.intervalID != null) clearInterval(body.multibox.intervalID);
                                    for (let o of body.multibox.controlledTanks)
                                        if (o.isAlive()) o.kill();
                                    body.multibox.controlledTanks = [];
                                };
                                if (!body.multibox.enabled) body.toggleMultibox();
                                body.multibox.enabled = true;
                            }
                    }
                    break;
                case prefix + "disco": // Turns the room into disco mode
                case prefix2 + "disco":
                    {
                        if (commandsDisabled) return sendDisabled("Disco");
                        if (!checkPermission(true, 1)) return;
                        let color = command.slice(1, command.length).join(" ");
                        if ((isNaN(color) || color < 0 || color > 8) && color !== "reset") return sendNormal("Disco", "Please specify a number between 0 and 8, or the word `reset`.", "Error", 0xFFFF00);
                        for (let loc of room.norm) room.setType(["n_b1", "n_b2", "n_b3", "n_b4", "n_b5", "n_b6", "n_b7", "n_b8", "domi", "norm", "roid", "rock"][color !== "reset" ? (!color ? Math.floor(Math.random() * 12) : color) : 9], loc);
                        let text = color !== "reset" ? "discofied" : "reset";
                        sendNormal("Disco", "Map has been " + text + ".", "Info", 0x277ECD);
                    }
                    break;
                case prefix + "manualOffset": // Randomizes upgrades
                case prefix + "mo":
                case prefix2 + "manualOffset":
                case prefix2 + "mo":
                    {
                        if (commandsDisabled) return sendDisabled("Manual Offset");
                        if (!checkPermission(true, 1)) return;
                        let seed = command.slice(1, command.length).join(" ");
                        if (isNaN(seed) || seed < -188 || seed > tankList.length - 189) return sendNormal("Manual Offset", "Please specify a number between -188 and " + (tankList.length - 189) + " .", "Error", 0xFFFF00);
                        if (seed == "") seed = Math.floor(Math.random() * tankList.length - 189) - 188;
                        room.manualOffset = Number(seed);
                        sendNormal("Manual Offset", "The Upgrades have been mixed up. Seed: " + seed, "Info", 0x277ECD);
                    }
                    break;
                case prefix + "push": // Pushes specified tank upgrades to other specified tanks
                case prefix2 + "push":
                    {
                        if (commandsDisabled) return sendDisabled("Push Upgrades");
                        if (!checkPermission(true, 1)) return;
                        let tank = command.slice(1, 2).join(" "),
                            tier = +command[2],
                            upgr = command.slice(3, command.length).join(" ");
                        if (tier < 2 || tier > 4 || isNaN(tier)) return sendNormal("Push Upgrades", "Tier value must be between 2 and 4.", "Error", 0xFFFF00);
                        switch (tier) {
                            case 2:
                                Class[tank].UPGRADES_TIER_2.push(Class[upgr]);
                                break;
                            case 3:
                                Class[tank].UPGRADES_TIER_3.push(Class[upgr]);
                                break;
                            case 4:
                                Class[tank].UPGRADES_TIER_4.push(Class[upgr]);
                                break;
                        }
                        sendNormal("Push Upgrades", `${Class[upgr].LABEL} is now a tier ${tier + 1} upgrade from ${Class[tank].LABEL}.`, "Info", 0x277ECD);
                    }
                    break;
                case prefix + "msg": // Makes the bot send a message in a specified channel
                case prefix + "message":
                case prefix2 + "msg":
                case prefix2 + "message":
                    {
                        if (commandsDisabled) return sendDisabled("Message");
                        if (!checkPermission(true, 3)) return;
                        let id = command.slice(1, 2).join(" "),
                            message = command.slice(2, command.length).join(" ");
                        if (isNaN(id)) return sendNormal("Message", "Please specify a valid channel ID.", "Error", 0xFFFF00);
                        bot.createMessage(id, message);
                        sendNormal("Message", `Message sent to <#${id}>.`, "Info", 0x277ECD);
                    }
                    break;
                case prefix + "s": // Makes the bot send a playerlist/botlist-esque list of specified entities
                case prefix + "search":
                case prefix2 + "s":
                case prefix2 + "search":
                    {
                        if (commandsDisabled) return sendDisabled("Search Query");
                        let list = [],
                            typeA = command.slice(1, 2).join(" "),
                            typeB = command.slice(2, command.length).join(" "),
                            search = null;
                        if (Array.isArray(typeB)) search = entities.filter(body => body[`${typeA}`] == typeB[0]);
                        else search = entities.filter(body => body[`${typeA}`] == `${typeB}`);
                        if (!typeA.length || !typeB.length) return sendNormal("Search Query", "There must at least two valid inputs.");
                        if (!search.length) return sendNormal("Search Query", "That's not in the server.", "Info", 0x277ECD);
                        for (let body of search) list.push({
                            name: trimName(body.name) + " - " + body.index,
                            value: body.id + " - " + body.label + " (" + body.skill.score + ")",
                            inline: false
                        });
                        bot.createMessage(msg.channel.id, {
                            embed: {
                                author: {
                                    name: "Search Query (" + search.length + ")",
                                    icon_url: "https://cdn.discordapp.com/avatars/462721019959050240/ee8807bc4fccc425cde794713c9daf54.png?size=256"
                                },
                                color: 0x8ABC3F,
                                fields: JSON.parse(JSON.stringify(list))
                            }
                        });
                    }
                    break;
                case prefix + "tpt": // Teleports a specified entity to another specified entity
                case prefix2 + "tpt":
                    {
                        if (commandsDisabled) return sendDisabled("Teleport To");
                        if (!checkPermission(true, 3)) return;
                        let idA = +command[1],
                            idB = +command[2];
                        if (typeof idA !== "number" || typeof idB !== "number") return sendNormal("Teleport", "Please specify valid player IDs.", "Error", 0xFFFF00);
                        let bodyA = getEntity(idA),
                        bodyB = getEntity(idB);
                        if (bodyA == null) return sendInvalidID("Teleport To", idA);
                        if (bodyB == null) return sendInvalidID("Teleport To", idB);
                        bodyA.x = bodyB.x;
                        bodyA.y = bodyB.y;
                        sendNormal("Teleport To", "Teleported " + trimName(bodyA.name) + " to " + trimName(bodyB.name) + ".", "Info", 0x277ECD);
                    }
                    break;
                case prefix + "guninfo": // Sends info about a specified player's guns
                case prefix + "g":
                case prefix2 + "guninfo":
                case prefix2 + "g":
                    {
                        if (commandsDisabled) return sendDisabled("Gun Info");
                        let id = +command[1],
                            gun = command[2];
                        if (typeof id !== "number") return sendNormal("Gun Info", "Please specify a valid tank export.", "Error", 0xFFFF00);
                        let body = getEntity(id);
                        if (body == null) return sendInvalidID("Gun Info", id);
                        if (typeof gun !== "string" && gun != undefined) return sendNormal("Gun Info", "Please specify a valid gun value.", "Error", 0xFFFF00);
                        if (gun == undefined) return sendNormal("Gun Info", trimName(body.name) + "'s gun amount: " + body.guns.length, "Info", 0x277ECD);
                        if (isNaN(gun) || gun > body.guns.length || gun < 1) return sendNormal("Gun Info", "Please specify a valid gun value.", "Error", 0xFFFF00);
                        gun--;
                        gun = body.guns[gun];
                        let stats = "N/a",
                            shot = "N/a",
                            ice = "false",
                            poison = "false",
                            critical = "false";
                        if (gun.canShoot) {
                            stats = gun.settings;
                            stats = "`" + Object.keys(stats).map(i => stats[i]) + "`";
                            shot = gun.bulletTypes[0].LABEL;
                            if (gun.bulletTypes[0].ICE != undefined) ice = "'" + gun.bulletTypes[0].ICE[0] + "'";
                            if (gun.bulletTypes[0].POISON != undefined) poison = "'" + gun.bulletTypes[0].POISON[0] + "'";
                            if (gun.bulletTypes[0].CAN_CRITICAL != undefined) critical = "'" + gun.bulletTypes[0].CAN_CRITICAL + "'";
                        }
                        //console.log(typeof ice);
                        //console.log(ice);
                        bot.createMessage(msg.channel.id, {
                            embed: {
                                author: {
                                    name: "Gun Info (" + c.serverName + ")",
                                    icon_url: "https://cdn.discordapp.com/avatars/462721019959050240/ee8807bc4fccc425cde794713c9daf54.png?size=256"
                                },
                                color: 0x277ECD,
                                fields: [{
                                    name: "Stats",
                                    value: stats,
                                    inline: false
                                }, {
                                    name: "Ammunition",
                                    value: shot,
                                    inline: false
                                }, {
                                    name: "Skin",
                                    value: gun.skin,
                                    inline: false
                                }/*, {
                                    name: "Abilities?",
                                    value: "Ice: " + ice + ", Poison: " + poison + ", Criticals: " + critical,
                                    inline: false
                                }*/]
                            }
                        });
                    }
                    break;
                case prefix + "rt": // Displays time until the next restart
                case prefix + "restarttime":
                case prefix2 + "rt":
                case prefix2 + "restarttime":
                    {
                        if (commandsDisabled) return sendDisabled("Restart Timer");
                        if (!c.restarts.enabled) return sendNormal("Restart Timer", "Automatic restarting is not enabled for this server.", "Error", 0xFFFF00);
                        let time = +command[1];
                        if (!time) {
                            let hours = (room.timeUntilRestart / 60 / 60).toFixed(2),
                                minutes = (room.timeUntilRestart / 60).toFixed(1);
                            sendNormal("Restart Timer", (hours < 1 ? minutes : hours) + (hours < 1 ? " minutes." : " hours."), "Time until the next restart:", 0x8ABC3F);
                        } else {
                            if (!checkPermission(true, 1)) return;
                            if (isNaN(time)) return sendNormal("Restart Timer", "Please specify a valid restart time.", "Error", 0xFFFF00);
                            room.timeUntilRestart = time;
                            let hours = (time / 60 / 60).toFixed(2),
                                minutes = (time / 60).toFixed(1);
                            sendNormal("Restart Timer", "Set the automatic restart timer to " + (hours < 1 ? minutes : hours) + (hours < 1 ? " minutes." : " hours."), "Info", 0x8ABC3F);
                        }
                    }
                    break;
                /*case prefix + "rc":
                case prefix + "reloadconfig": // Reloads the config.json file associated with the server
                    {
                        if (commandsDisabled) return sendDisabled("Reload Configs");
                        if (!checkPermission()) return;
                        c = require(`../../configs/config${serverPrefix}.json`);
                        sendNormal("Message", "Successfully reloaded the config" + serverPrefix + ".json file.", "Info", 0x277ECD);
                    }
                    break;*/
                default:
                    if ((msg.content.startsWith(prefix) || msg.content.startsWith(prefix2)) && msg.content.length > 1) sendNormal("Arras.io Controller", "That is an invalid command. Try `" + prefix + "help` for a list of commands.", "Error", 0xFF0000);
                    break;
            }
        } catch (e) {
            util.error("The following error occurred while running the command " + command[0].toLowerCase() + ":");
            util.error(e);
            bot.createMessage("464874675999211522", {
                embed: {
                    author: {
                        name: c.serverName,
                        icon_url: "https://cdn.discordapp.com/avatars/462721019959050240/ee8807bc4fccc425cde794713c9daf54.png?size=256"
                    },
                    color: 0xFFFF00,
                    fields: [{
                        name: "Command Parsing Error",
                        value: " " + e,
                        inline: false
                    }, {
                        name: "Culprit Command",
                        value: command[0].toLowerCase(),
                        inline: false
                    }]
                }
            });
        }
    });
    bot.editStatus(status, {
        name: playingTag,
        type: 0
    });
    bot.connect();
}
if (c.commandParsing) {
    setTimeout(() => util.log("Command parsing is enabled."), 345);
    const input = require("readline").createInterface({
        input: process.stdin,
        output: process.stdout
    });
    let CommandList = {
        help: () => {
            console.log("+--------------------+"),
            console.log("|  [33mLIST OF COMMANDS[0m  |"),
            console.log("+--------------------+-------------------------------------------------------------------------+"),
            console.log("| say [text]         | Simply makes the console say what you put in place of [text].           |"),
            console.log("| exit               | Closes the arena. Running it a second time force shuts down the server. |"),
            console.log("| botamount [number] | Sets the maximum amount of bots that can spawn.                         |"),
            console.log("| playerlist         | Lists all players currently playing in the server.                      |"),
            console.log("| broadcast [text]   | Sends a message to all players.                                         |"),
            console.log("| eval [code]        | Makes the server run specified code.                                    |"),
            console.log("| keyhelp            | Lists all keys that come with level 1 and 2 beta-testers.               |"),
            console.log("+----------------------------------------------------------------------------------------------+");
        },
        keyhelp: () => {
            console.log("+---------------+"),
            console.log("| [33mDEV MODE KEYS[0m |"),
            console.log("+---------------------------------+"),
            console.log("| [33m/[0m | Upgrade to TESTBED          |"),
            console.log("| [33mK[0m | Suicide                     |"),
            console.log("| [33mP[0m | Reset to Basic tank         |"),
            console.log("| [33m=[0m | Enable/disable rainbow mode |"),
            console.log("| [33mX[0m | Enable/disable passive mode |"),
            // Level 1 keys above, level 2 keys below
            console.log("| [33mB[0m | Change color                |"),
            console.log("| [33m;[0m | Enable/disable godmode      |"),
            console.log("| [33mF[0m | Spawn stuff at mouse        |"),
            console.log("| [33mT[0m | Teleport to mouse           |"),
            console.log("| [33mY[0m | Reset to default color      |"),
            console.log("| [33mG[0m | Kill what your mouse is on  |"),
            console.log("| [33mJ[0m | Enable/disable stealth mode |"),
            console.log("+---------------------------------+");
        },
        say: args => {
            console.log(args.slice(1, args.length).join(" "));
        },
        exit: () => {
            if (room.arenaClosed) {
                util.warn("Force exit induced! Ending process...");
                process.exit();
            } else {
                util.warn("Server going down! Warning broadcasted.");
                if (c.enableBot) sendClosed(c.serverName, "Reason: Force Exit", "Arena has been closed by the console.");
                closeArena();
            }
        },
        botamount: args => {
            let value = args[1];
            if (!value) return util.warn("Please specify a valid bot amount.");
            room.maxBots = value;
            util.info("Set the maximum bot amount to " + value + ".");
        },
        playerlist: () => {
            let users = clients.filter(socket => socket.player.body != null && !socket.player.body.isGhost);
            if (!users.length) return util.info("No players are currently playing in the server.");
            let list = "[PLAYERLIST]:\n ";
            for (let socket of users) {
                let body = socket.player.body;
                list += "  " + trimName(body.name) + ": " + body.id + " - " + body.label + " (" + body.skill.score + ")\n ";
            }
            console.log(list);
        },
        broadcast: args => {
            sockets.broadcast(args.slice(1, args.length).join(" "));
            util.info("Broadcasted your message to all players.");
        },
        eval: args => {
            try {
                console.log("[31m[OUTPUT][0m " + eval(args.slice(1, args.length).join(" ")) + ".");
            } catch (e) {
                util.error(e);
            }
        }
    };
    const parseCommands = string => {
        if (!string) return;
        let split = string.split(" "),
            execute = CommandList[split[0].toLowerCase()];
        if (typeof execute === "undefined") return util.warn("Invalid command specified.");
        execute(split);
    };
    const prompt = () => {
        input.question("", string => {
            try {
                parseCommands(string);
            } catch (e) {
                util.error(e.stack);
            } finally {
                setTimeout(prompt, 0);
            }
        });
    };
    setTimeout(prompt, 200);
}