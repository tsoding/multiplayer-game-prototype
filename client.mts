import * as common from './common.mjs'
import type {Player, Direction} from './common.mjs';

const DIRECTION_KEYS: {[key: string]: Direction} = {
    'ArrowLeft'  : 'left',
    'ArrowRight' : 'right',
    'ArrowUp'    : 'up',
    'ArrowDown'  : 'down',
    'KeyA'       : 'left',
    'KeyD'       : 'right',
    'KeyS'       : 'down',
    'KeyW'       : 'up',
};

(async () => {
    const gameCanvas = document.getElementById('game') as HTMLCanvasElement | null;
    if (gameCanvas === null) throw new Error('No element with id `game`');
    gameCanvas.width = common.WORLD_WIDTH;
    gameCanvas.height = common.WORLD_HEIGHT;
    const ctx = gameCanvas.getContext("2d");
    if (ctx === null) throw new Error('2d canvas is not supported');

    let ws: WebSocket | undefined = new WebSocket(`ws://${window.location.hostname}:${common.SERVER_PORT}`);
    let me: Player | undefined = undefined;
    const players = new Map<number, Player>();
    ws.binaryType = 'arraybuffer';
    ws.addEventListener("close", (event) => {
        console.log("WEBSOCKET CLOSE", event)
        ws = undefined
    });
    ws.addEventListener("error", (event) => {
        // TODO: reconnect on errors
        console.log("WEBSOCKET ERROR", event)
    });
    ws.addEventListener("message", (event) => {
        // console.log('Received message', event);
        if (me === undefined) {
            const view = new DataView(event.data);
            if (common.HelloStruct.size === view.byteLength && common.HelloStruct.kind.read(view, 0) === common.MessageKind.Hello) {
                me = {
                    id: common.HelloStruct.id.read(view, 0),
                    x: common.HelloStruct.x.read(view, 0),
                    y: common.HelloStruct.y.read(view, 0),
                    moving: {
                        'left': false,
                        'right': false,
                        'up': false,
                        'down': false,
                    },
                    hue: common.HelloStruct.hue.read(view, 0)/256*360,
                }
                players.set(me.id, me)
            } else {
                console.error("Received bogus-amogus message from server. Incorrect `Hello` message.", view)
                ws?.close();
            }
        } else {
            const view = new DataView(event.data)
            if (common.PlayerJoinedStruct.size === view.byteLength && common.PlayerJoinedStruct.kind.read(view, 0) === common.MessageKind.PlayerJoined) {
                const id = common.PlayerJoinedStruct.id.read(view, 0);
                const player = {
                    id,
                    x: common.PlayerJoinedStruct.x.read(view, 0),
                    y: common.PlayerJoinedStruct.y.read(view, 0),
                    moving: {
                        'left': false,
                        'right': false,
                        'up': false,
                        'down': false,
                    },
                    hue: common.PlayerJoinedStruct.hue.read(view, 0)/256*360,
                }
                common.setMovingMask(player.moving, common.PlayerJoinedStruct.moving.read(view, 0))
                players.set(id, player);
            } else if (common.PlayerLeftStruct.size === view.byteLength && common.PlayerLeftStruct.kind.read(view, 0) === common.MessageKind.PlayerLeft) {
                players.delete(common.PlayerLeftStruct.id.read(view, 0))
            } else if (common.PlayerMovingStruct.size === view.byteLength && common.PlayerMovingStruct.kind.read(view, 0) === common.MessageKind.PlayerMoving) {
                const id = common.PlayerMovingStruct.id.read(view, 0);
                const player = players.get(id);
                if (player === undefined) {
                    console.error(`Received bogus-amogus message from server. We don't know anything about player with id ${id}`)
                    ws?.close();
                    return;
                }
                const moving = common.PlayerMovingStruct.moving.read(view, 0);
                const x = common.PlayerMovingStruct.x.read(view, 0);
                const y = common.PlayerMovingStruct.y.read(view, 0);
                common.setMovingMask(player.moving, moving);
                player.x = x;
                player.y = y;
            } else {
                console.error("Received bogus-amogus message from server.", view)
                ws?.close();
            }
        }
    });
    ws.addEventListener("open", (event) => {
        console.log("WEBSOCKET OPEN", event)
    });

    let previousTimestamp = 0;
    const frame = (timestamp: number) => {
        const deltaTime = (timestamp - previousTimestamp)/1000;
        previousTimestamp = timestamp;

        ctx.fillStyle = '#202020';
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

        if (ws === undefined) {
            const label = "Disconnected";
            const size = ctx.measureText(label);
            ctx.font = "48px bold";
            ctx.fillStyle = 'white';
            ctx.fillText(label, ctx.canvas.width/2 - size.width/2, ctx.canvas.height/2);
        } else {
            players.forEach((player) => {
                if (me !== undefined && me.id !== player.id) {
                    common.updatePlayer(player, deltaTime);
                    ctx.fillStyle = `hsl(${player.hue} 70% 40%)`;
                    ctx.fillRect(player.x, player.y, common.PLAYER_SIZE, common.PLAYER_SIZE);
                }
            })

            if (me !== undefined) {
                common.updatePlayer(me, deltaTime);
                ctx.fillStyle = `hsl(${me.hue} 100% 40%)`;
                ctx.fillRect(me.x, me.y, common.PLAYER_SIZE, common.PLAYER_SIZE);

                ctx.strokeStyle = "white";
                ctx.lineWidth = 4;
                ctx.beginPath()
                ctx.strokeRect(me.x, me.y, common.PLAYER_SIZE, common.PLAYER_SIZE);
                ctx.stroke();
            }
        }
        window.requestAnimationFrame(frame);
    }
    window.requestAnimationFrame((timestamp) => {
        previousTimestamp = timestamp;
        window.requestAnimationFrame(frame);
    });

    window.addEventListener("keydown", (e) => {
        if (ws !== undefined && me !== undefined) {
            if (!e.repeat) {
                const direction = DIRECTION_KEYS[e.code];
                if (direction !== undefined) {
                    me.moving[direction] = true;
                    const view = new DataView(new ArrayBuffer(common.AmmaMovingStruct.size));
                    common.AmmaMovingStruct.kind.write(view, 0, common.MessageKind.AmmaMoving);
                    common.AmmaMovingStruct.moving.write(view, 0, common.movingMask(me.moving));
                    ws.send(view);
                }
            }
        }
    });
    window.addEventListener("keyup", (e) => {
        if (ws !== undefined && me !== undefined) {
            if (!e.repeat) {
                const direction = DIRECTION_KEYS[e.code];
                if (direction !== undefined) {
                    me.moving[direction] = false;
                    const view = new DataView(new ArrayBuffer(common.AmmaMovingStruct.size));
                    common.AmmaMovingStruct.kind.write(view, 0, common.MessageKind.AmmaMoving);
                    common.AmmaMovingStruct.moving.write(view, 0, common.movingMask(me.moving));
                    ws.send(view);
                }
            }
        }
    });
})()
