import Phaser from 'phaser';
import * as Colyseus from 'colyseus.js';
import { OfficeState, AgentState } from './schema';
import { eventBus } from '../events';

let activeRoom: Colyseus.Room<OfficeState> | undefined;
let connectingPromise: Promise<Colyseus.Room<OfficeState>> | undefined;

export function getColyseusRoom() {
    return activeRoom;
}

/** Ensure a single Colyseus connection exists. Called from App on mount. */
export async function ensureColyseusConnection(): Promise<Colyseus.Room<OfficeState>> {
    if (activeRoom) return activeRoom;
    if (connectingPromise) return connectingPromise;

    connectingPromise = (async () => {
        console.log("[App] Connecting to Colyseus...");
        const client = new Colyseus.Client('ws://localhost:3000');
        const room = await client.joinOrCreate<OfficeState>('office');
        activeRoom = room;
        console.log("[App] Colyseus connected!", room.sessionId);
        return room;
    })();

    return connectingPromise;
}

export class OfficeScene extends Phaser.Scene {
    private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
    private room?: Colyseus.Room;
    private agentSprites: Map<string, Phaser.GameObjects.Container> = new Map();
    private statusText!: Phaser.GameObjects.Text;
    private followTarget: Phaser.GameObjects.Container | null = null;

    constructor() {
        super('OfficeScene');
    }

    preload() {
        // Load all 6 character spritesheets
        for (let i = 0; i <= 5; i++) {
            this.load.spritesheet(`char_${i}`, `/assets/characters/char_${i}.png`, {
                frameWidth: 16,
                frameHeight: 32
            });
        }
    }

    create() {
        try {
            console.log("Phaser create() started");
            this.statusText = this.add.text(10, 10, 'Colyseus Sync: Connecting...', { color: '#ffffaa', fontSize: '14px' });
            this.statusText.setScrollFactor(0);
            this.statusText.setDepth(100);

            // Create walk animations for all 6 character spritesheets
            for (let i = 0; i <= 5; i++) {
                const key = `char_${i}`;
                if (this.textures.exists(key)) {
                    const anims = this.anims;
                    anims.create({ key: `${key}-walk-down`, frames: anims.generateFrameNumbers(key, { start: 0, end: 2 }), frameRate: 8, repeat: -1 });
                    anims.create({ key: `${key}-walk-up`, frames: anims.generateFrameNumbers(key, { start: 7, end: 9 }), frameRate: 8, repeat: -1 });
                    anims.create({ key: `${key}-walk-right`, frames: anims.generateFrameNumbers(key, { start: 14, end: 16 }), frameRate: 8, repeat: -1 });
                }
            }
            console.log("Animations created for 6 characters");

            const gridSize = 40 * 16; // 640px
            const g = this.add.graphics();

            // ═══════════════════════════════════════════
            //  FLOORING
            // ═══════════════════════════════════════════
            g.fillStyle(0x2d2d3d, 1);
            g.fillRect(0, 0, gridSize, gridSize);
            g.fillStyle(0x33334a, 1);
            g.fillRect(16, 16, gridSize - 32, gridSize - 32);

            // Executive area floor (top center, subtle gold tint)
            g.fillStyle(0x3a3530, 1);
            g.fillRect(200, 32, 240, 160);

            // Tech Team floor (left, blue tint)
            g.fillStyle(0x2a3045, 1);
            g.fillRect(32, 230, 190, 220);

            // Sales Team floor (right, green tint)
            g.fillStyle(0x2a3d30, 1);
            g.fillRect(420, 230, 190, 220);

            // Business Team floor (center-bottom, amber tint)
            g.fillStyle(0x3d3525, 1);
            g.fillRect(180, 450, 280, 160);

            // Coffee area tiles (bottom-right corner, checkerboard)
            for (let tx = 0; tx < 7; tx++) {
                for (let ty = 0; ty < 5; ty++) {
                    g.fillStyle((tx + ty) % 2 === 0 ? 0x2a3a2a : 0x253025, 1);
                    g.fillRect(500 + tx * 16, 530 + ty * 16, 16, 16);
                }
            }

            // ═══════════════════════════════════════════
            //  WALLS & PARTITIONS
            // ═══════════════════════════════════════════
            // ─── ROOM WALLS (drawn with gaps for doors) ───

            // Helper: draw a horizontal door (gap in top/bottom wall)
            const drawHDoor = (x: number, y: number, w: number) => {
                // Clear the wall line
                g.fillStyle(0x33334a, 1);
                g.fillRect(x, y - 2, w, 6);
                // Door frame posts
                g.fillStyle(0x5a3e28, 1);
                g.fillRect(x, y - 3, 4, 8);
                g.fillRect(x + w - 4, y - 3, 4, 8);
                // Doormat
                g.fillStyle(0x6d4c2e, 0.5);
                g.fillRect(x + 6, y + 4, w - 12, 4);
            };

            // Helper: draw a vertical door (gap in left/right wall)
            const drawVDoor = (x: number, y: number, h: number) => {
                // Clear the wall line
                g.fillStyle(0x33334a, 1);
                g.fillRect(x - 2, y, 6, h);
                // Door frame posts
                g.fillStyle(0x5a3e28, 1);
                g.fillRect(x - 3, y, 8, 4);
                g.fillRect(x - 3, y + h - 4, 8, 4);
                // Doormat
                g.fillStyle(0x6d4c2e, 0.5);
                g.fillRect(x + 4, y + 6, 4, h - 12);
            };

            // Executive area border
            g.lineStyle(2, 0xdfe6e9, 0.5);
            g.strokeRect(200, 32, 240, 160);
            drawHDoor(300, 190, 40);

            // Tech Team border
            g.lineStyle(2, 0x74b9ff, 0.6);
            g.strokeRect(32, 230, 190, 220);
            drawVDoor(221, 320, 40);

            // Sales Team border
            g.lineStyle(2, 0x00b894, 0.6);
            g.strokeRect(420, 230, 190, 220);
            drawVDoor(421, 320, 40);

            // Business Team border
            g.lineStyle(2, 0xfdcb6e, 0.6);
            g.strokeRect(180, 450, 280, 160);
            drawHDoor(300, 450, 40);

            // Coffee / Pantry border
            g.lineStyle(2, 0x00b894, 0.4);
            g.strokeRect(500, 530, 112, 80);
            drawVDoor(501, 550, 30);

            // ═══════════════════════════════════════════
            //  ZONE LABELS
            // ═══════════════════════════════════════════
            this.add.text(320, 42, '👔 EXECUTIVE', { fontSize: '10px', color: '#dfe6e9' }).setOrigin(0.5);
            this.add.text(127, 240, '💻 TECH TEAM', { fontSize: '10px', color: '#74b9ff' }).setOrigin(0.5);
            this.add.text(515, 240, '📈 SALES TEAM', { fontSize: '10px', color: '#00b894' }).setOrigin(0.5);
            this.add.text(320, 460, '📊 BUSINESS TEAM', { fontSize: '10px', color: '#fdcb6e' }).setOrigin(0.5);
            this.add.text(556, 540, '☕ Pantry', { fontSize: '8px', color: '#7fcdaa' }).setOrigin(0.5);

            // ═══════════════════════════════════════════
            //  WORKSTATION HELPER
            // ═══════════════════════════════════════════
            const drawWorkstation = (x: number, y: number, label: string, screenColor: number) => {
                // Desk
                g.fillStyle(0x5a3e28, 1);
                g.fillRect(x, y, 56, 28);
                g.fillStyle(0x6d4c2e, 1);
                g.fillRect(x + 2, y + 2, 52, 24);
                // Monitor
                g.fillStyle(0x2d3436, 1);
                g.fillRect(x + 6, y + 3, 22, 14);
                g.fillStyle(screenColor, 1);
                g.fillRect(x + 8, y + 5, 18, 10);
                g.fillStyle(0x636e72, 1);
                g.fillRect(x + 14, y + 17, 10, 3);
                g.fillRect(x + 10, y + 20, 18, 2);
                // Keyboard + mouse
                g.fillStyle(0xb2bec3, 1);
                g.fillRect(x + 6, y + 22, 18, 4);
                g.fillRect(x + 28, y + 22, 5, 4);
                // Chair
                g.fillStyle(0x2d3436, 1);
                g.fillCircle(x + 22, y + 38, 8);
                g.fillStyle(screenColor, 0.6);
                g.fillCircle(x + 22, y + 38, 6);
                // Label
                this.add.text(x + 28, y - 6, label, { fontSize: '7px', color: '#a0a0c0' }).setOrigin(0.5);
            };

            // ═══════════════════════════════════════════
            //  EXECUTIVE AREA — Manager desk (larger)
            // ═══════════════════════════════════════════
            // Manager's executive desk (wider)
            g.fillStyle(0x5a3e28, 1);
            g.fillRect(280, 60, 80, 32);
            g.fillStyle(0x7d5c3e, 1);
            g.fillRect(282, 62, 76, 28);
            // Dual monitors
            g.fillStyle(0x2d3436, 1);
            g.fillRect(290, 64, 22, 14);
            g.fillRect(328, 64, 22, 14);
            g.fillStyle(0xdfe6e9, 1);
            g.fillRect(292, 66, 18, 10);
            g.fillRect(330, 66, 18, 10);
            // Chair
            g.fillStyle(0x2d3436, 1);
            g.fillCircle(320, 104, 10);
            g.fillStyle(0xdfe6e9, 0.5);
            g.fillCircle(320, 104, 8);
            this.add.text(320, 54, '👔 Jensen (CEO)', { fontSize: '7px', color: '#dfe6e9' }).setOrigin(0.5);

            // Whiteboard in executive area
            g.fillStyle(0xdfe6e9, 1);
            g.fillRect(220, 40, 60, 30);
            g.lineStyle(2, 0x636e72, 1);
            g.strokeRect(220, 40, 60, 30);
            g.lineStyle(1, 0x0984e3, 0.5);
            g.beginPath();
            g.moveTo(226, 50); g.lineTo(245, 46); g.lineTo(265, 52);
            g.strokePath();

            // Meeting table
            g.fillStyle(0x6d4c2e, 1);
            g.fillRect(270, 130, 100, 40);
            g.fillStyle(0x7d5c3e, 1);
            g.fillRect(274, 134, 92, 32);
            // Chairs around table
            const meetChairs = [[290, 124], [330, 124], [370, 124], [290, 178], [330, 178], [370, 178]];
            meetChairs.forEach(([cx, cy]) => {
                g.fillStyle(0x4a4a6a, 1);
                g.fillCircle(cx, cy, 5);
            });

            // ═══════════════════════════════════════════
            //  TECH DESK (left, blue screen)
            // ═══════════════════════════════════════════
            drawWorkstation(54, 268, '💻 Linus (CTO)', 0x74b9ff);

            // ═══════════════════════════════════════════
            //  SALES DESK (right, green screen)
            // ═══════════════════════════════════════════
            drawWorkstation(478, 268, '📈 Marc (VP Sales)', 0x00b894);

            // ═══════════════════════════════════════════
            //  BUSINESS DESK (center-bottom, amber screen)
            // ═══════════════════════════════════════════
            drawWorkstation(205, 490, '📊 Warren (CFO)', 0xfdcb6e);

            // ═══════════════════════════════════════════
            //  COFFEE / PANTRY (bottom-right corner)
            // ═══════════════════════════════════════════
            // Counter
            g.fillStyle(0x5a3e28, 1);
            g.fillRect(510, 555, 60, 18);
            g.fillStyle(0x6d4c2e, 1);
            g.fillRect(512, 557, 56, 14);
            // Coffee machine
            g.fillStyle(0x2d3436, 1);
            g.fillRect(520, 545, 16, 20);
            g.fillStyle(0x636e72, 1);
            g.fillRect(522, 547, 12, 10);
            g.fillStyle(0xd63031, 1);
            g.fillCircle(528, 562, 2);
            // Water cooler
            g.fillStyle(0x74b9ff, 0.5);
            g.fillRect(570, 550, 10, 20);
            g.fillStyle(0xdfe6e9, 1);
            g.fillRect(568, 570, 14, 12);

            // ═══════════════════════════════════════════
            //  DECORATIONS
            // ═══════════════════════════════════════════
            const drawPlant = (px: number, py: number) => {
                g.fillStyle(0x8b4513, 1);
                g.fillRect(px - 5, py, 10, 8);
                g.fillStyle(0xa0522d, 1);
                g.fillRect(px - 4, py + 1, 8, 6);
                g.fillStyle(0x3e2723, 1);
                g.fillRect(px - 3, py, 6, 2);
                g.fillStyle(0x27ae60, 1);
                g.fillCircle(px, py - 4, 6);
                g.fillStyle(0x2ecc71, 1);
                g.fillCircle(px - 3, py - 6, 4);
                g.fillCircle(px + 4, py - 5, 4);
            };
            drawPlant(40, 228);    // Tech area entrance
            drawPlant(610, 228);   // Sales area entrance
            drawPlant(200, 200);   // Center corridor
            drawPlant(440, 200);   // Center corridor
            drawPlant(180, 610);   // Business area corner
            drawPlant(460, 610);   // Business area corner

            // ═══════════════════════════════════════════
            //  SUBTLE GRID
            // ═══════════════════════════════════════════
            g.lineStyle(1, 0x444466, 0.08);
            g.beginPath();
            for (let i = 0; i <= gridSize; i += 16) {
                g.moveTo(i, 0).lineTo(i, gridSize);
                g.moveTo(0, i).lineTo(gridSize, i);
            }
            g.strokePath();

            this.cameras.main.setBackgroundColor('#16213e');
            this.cameras.main.setZoom(1.5);
            this.cameras.main.centerOn(gridSize / 2, gridSize / 2);

            // Mouse-wheel zoom
            this.game.canvas.addEventListener('wheel', (e: WheelEvent) => {
                e.preventDefault();
                const cam = this.cameras.main;
                const delta = e.deltaY > 0 ? -0.15 : 0.15;
                const newZoom = Phaser.Math.Clamp(cam.zoom + delta, 0.5, 4);
                cam.setZoom(newZoom);
            }, { passive: false });

            // Right-click or middle-click drag to pan camera
            this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
                if (pointer.rightButtonDown() || pointer.middleButtonDown()) {
                    this.followTarget = null;
                }
            });
            this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
                if (pointer.isDown && (pointer.rightButtonDown() || pointer.middleButtonDown())) {
                    const cam = this.cameras.main;
                    cam.scrollX -= (pointer.x - pointer.prevPosition.x) / cam.zoom;
                    cam.scrollY -= (pointer.y - pointer.prevPosition.y) / cam.zoom;
                }
            });

            // Disable right-click context menu on the canvas
            this.game.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

            if (this.input.keyboard) {
                this.cursors = this.input.keyboard.createCursorKeys();
            }

            this.connectToServer();
        } catch (e) {
            console.error("CRITICAL PHASER ERROR", e);
        }
    }

    async connectToServer() {
        try {
            // Reuse the shared connection (established by App on mount)
            this.room = await ensureColyseusConnection();

            console.log("Phaser using shared Colyseus room", this.room.sessionId);
            this.statusText.setText('Colyseus Sync: Connected (Waiting for state...)').setColor('#aaffaa');

            // Setup state handlers — state may already be available if App connected first
            const initWithState = (state: any) => {
                console.log("Phaser state ready!", state.toJSON());
                console.log("Agents map size:", state.agents?.size);
                this.statusText.setText('Colyseus Sync: Active!').setColor('#00ff00');

                // Bind chat bus
                this.room!.onMessage('chat', (message: any) => {
                    eventBus.dispatchEvent(new CustomEvent('chat-message', { detail: message }));
                });

                state.agents.onAdd((agent: AgentState, sessionId: string) => {
                    console.log(`[Colyseus] Agent added: ${agent.name} at (${agent.x}, ${agent.y})`);
                    const container = this.add.container(agent.x * 16, agent.y * 16);

                    let sprite;
                    // Map agent IDs to character sprites
                    const spriteMap: Record<string, string> = {
                        'manager': 'char_0',
                        'cto': 'char_1',
                        'vp-sales': 'char_3',
                        'cfo': 'char_5',
                    };
                    let charKey = spriteMap[sessionId] || 'char_0';

                    if (this.textures.exists(charKey)) {
                        sprite = this.add.sprite(0, -8, charKey, 0);
                    } else {
                        sprite = this.add.rectangle(0, -8, 16, 32, 0x3a86ff);
                    }

                    // Thought bubble (word-wrapped)
                    const thoughtBubble = this.add.text(0, -36, '', {
                        fontSize: '9px',
                        color: '#e0e0e0',
                        backgroundColor: '#1a1a3eee',
                        padding: { x: 5, y: 4 },
                        align: 'center',
                        wordWrap: { width: 130, useAdvancedWrap: true }
                    }).setOrigin(0.5, 1);
                    thoughtBubble.setVisible(false);

                    // Emote bubble (emoji above head)
                    const emoteBubble = this.add.text(8, -24, '', {
                        fontSize: '12px'
                    }).setOrigin(0.5);
                    emoteBubble.setVisible(false);

                    // Name label
                    const label = this.add.text(0, 16, agent.name, {
                        fontSize: '10px', color: '#ffffff',
                        backgroundColor: '#00000088', padding: { x: 2, y: 1 }
                    }).setOrigin(0.5, 0);

                    // Focus highlight ring (hidden by default)
                    const focusRing = this.add.graphics();
                    focusRing.lineStyle(1, 0x6c5ce7, 0.8);
                    focusRing.strokeCircle(0, 0, 14);
                    focusRing.setVisible(false);

                    container.add([focusRing, sprite, thoughtBubble, emoteBubble, label]);
                    container.setSize(32, 48);
                    container.setInteractive();
                    this.agentSprites.set(sessionId, container);

                    // --- FOCUS MODE: Click to follow ---
                    container.on('pointerdown', () => {
                        if (this.followTarget === container) {
                            // Unfollow on second click
                            this.followTarget = null;
                            focusRing.setVisible(false);
                            eventBus.dispatchEvent(new CustomEvent('agent-focus', { detail: null }));
                        } else {
                            // Unfollow previous
                            if (this.followTarget) {
                                const prevRing = this.followTarget.getAt(0) as Phaser.GameObjects.Graphics;
                                prevRing?.setVisible(false);
                            }
                            this.followTarget = container;
                            focusRing.setVisible(true);
                            eventBus.dispatchEvent(new CustomEvent('agent-focus', { detail: { name: agent.name, id: sessionId } }));
                        }
                    });

                    let prevX = agent.x;
                    let prevY = agent.y;
                    let lastAction = '';

                    agent.onChange(() => {
                        this.tweens.add({
                            targets: container,
                            x: agent.x * 16,
                            y: agent.y * 16,
                            duration: 100,
                            onComplete: () => {
                                if (sprite.type === 'Sprite') {
                                    (sprite as Phaser.GameObjects.Sprite).stop();
                                }
                            }
                        });

                        // Walk animation
                        if (sprite.type === 'Sprite') {
                            const s = sprite as Phaser.GameObjects.Sprite;
                            if (agent.x > prevX) { s.play(`${charKey}-walk-right`, true); s.setFlipX(false); }
                            else if (agent.x < prevX) { s.play(`${charKey}-walk-right`, true); s.setFlipX(true); }
                            else if (agent.y > prevY) { s.play(`${charKey}-walk-down`, true); }
                            else if (agent.y < prevY) { s.play(`${charKey}-walk-up`, true); }
                            else { s.stop(); }
                        }

                        // --- EMOTE BUBBLES based on action ---
                        const emoteMap: Record<string, string> = {
                            'work': '💻', 'talk': '💬', 'idle': '😌',
                            'use_tool': '🔧', 'move': '🚶', 'think': '💡'
                        };
                        const emote = emoteMap[agent.action] || '';
                        if (emote && agent.action !== lastAction) {
                            emoteBubble.setText(emote);
                            emoteBubble.setVisible(true);
                            // Auto-hide after 3s
                            this.time.delayedCall(3000, () => emoteBubble.setVisible(false));
                        }

                        // Thought bubble
                        if (agent.thought && agent.thought !== '') {
                            thoughtBubble.setText(agent.thought);
                            thoughtBubble.setVisible(true);
                            this.time.delayedCall(6000, () => thoughtBubble.setVisible(false));
                        }

                        // --- SYSTEM LOG EVENT ---
                        if (agent.action !== lastAction || agent.thought !== '') {
                            eventBus.dispatchEvent(new CustomEvent('activity-log', {
                                detail: {
                                    agent: agent.name,
                                    action: agent.action,
                                    thought: agent.thought,
                                    time: new Date().toLocaleTimeString()
                                }
                            }));
                        }

                        lastAction = agent.action;
                        prevX = agent.x;
                        prevY = agent.y;
                    });
                });

                state.agents.onRemove((agent: AgentState, sessionId: string) => {
                    const sprite = this.agentSprites.get(sessionId);
                    if (sprite) {
                        sprite.destroy();
                        this.agentSprites.delete(sessionId);
                    }
                });
            };

            // If state is already available (App connected first), init immediately
            const currentState = (this.room as any).state;
            if (currentState && currentState.agents?.size > 0) {
                initWithState(currentState);
            } else {
                this.room.onStateChange.once(initWithState);
            }

        } catch (e) {
            console.error(e);
            this.statusText.setText('Colyseus Sync: Failed (Check Server)').setColor('#ffaaaa');
        }
    }

    update() {
        // If following an agent, smoothly track them
        if (this.followTarget) {
            const cam = this.cameras.main;
            const targetX = this.followTarget.x - cam.width / (2 * cam.zoom);
            const targetY = this.followTarget.y - cam.height / (2 * cam.zoom);
            cam.scrollX += (targetX - cam.scrollX) * 0.08;
            cam.scrollY += (targetY - cam.scrollY) * 0.08;
        } else {
            const speed = 5;
            if (this.cursors?.left.isDown) this.cameras.main.scrollX -= speed;
            if (this.cursors?.right.isDown) this.cameras.main.scrollX += speed;
            if (this.cursors?.up.isDown) this.cameras.main.scrollY -= speed;
            if (this.cursors?.down.isDown) this.cameras.main.scrollY += speed;
        }
    }
}

export function setupPhaser(parentId: string) {
    const config: Phaser.Types.Core.GameConfig = {
        type: Phaser.AUTO,
        parent: parentId,
        width: window.innerWidth,
        height: window.innerHeight,
        scene: [OfficeScene],
        pixelArt: true,
        scale: {
            mode: Phaser.Scale.RESIZE,
        },
        input: {
            keyboard: {
                capture: [] // Don't capture ANY keys globally — let React inputs work
            }
        }
    };

    const game = new Phaser.Game(config);

    // When ANY input/textarea/select is focused, fully disable Phaser keyboard
    // When they blur, re-enable it
    document.addEventListener('focusin', (e) => {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
            game.input.keyboard?.enabled && (game.input.keyboard.enabled = false);
        }
    });
    document.addEventListener('focusout', (e) => {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
            game.input.keyboard && (game.input.keyboard.enabled = true);
        }
    });

    return game;
}
