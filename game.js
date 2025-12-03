/**
 * MARS SHOT: Orbital Injection
 * Final Fixed Version - Mobile Buttons & Asteroid Sizes
 */

(function() { // Wrap in IIFE to protect scope

// ===================================
// 1. DATA & CONFIGURATION
// ===================================

const LEVELS_DATA = {
    levels: [
        { id: 1, name: "Level 1", asteroidCount: 3, asteroidMinSize: 15, asteroidMaxSize: 25 },
        { id: 2, name: "Level 2", asteroidCount: 8, asteroidMinSize: 15, asteroidMaxSize: 30 },
        // Reduced sizes for Level 3 & 4 as requested
        { id: 3, name: "Level 3", asteroidCount: 14, asteroidMinSize: 18, asteroidMaxSize: 28 }, 
        { id: 4, name: "Level 4", asteroidCount: 20, asteroidMinSize: 20, asteroidMaxSize: 32 }
    ],
    upgrades: {
        fuel: { baseCost: 50, name: "Fuel Tank", maxLevel: 5, costMultiplier: 1.5 },
        thrust: { baseCost: 80, name: "Ion Engine", maxLevel: 5, costMultiplier: 1.5 },
        launch: { baseCost: 60, name: "Catapult", maxLevel: 5, costMultiplier: 1.5 }
    }
};

const GameConfig = {
    SUN_MASS: 5000,
    EARTH_MASS: 100,
    MARS_MASS: 80,
    SATURN_MASS: 200,
    MOON_MASS: 10,
    G_BASE: 0.28, 
    MAX_INPUT_DIST: 300,
    ROCKET_TRAIL_LIMIT: 600,
    BODY_TRAIL_LIMIT: 60,
    COLLISION_PADDING: 15, 
    COLLISION_MIN_DIST: 10,
    LANDING_REWARD: 100,
    MAX_DISTANCE_SCORE: 50
};

// ===================================
// 2. EVENT MANAGER
// ===================================

class EventManager {
    constructor() { this.events = []; }
    on(target, event, handler, options = {}) {
        target.addEventListener(event, handler, options);
        this.events.push({ target, event, handler, options });
    }
}
const eventManager = new EventManager();

// ===================================
// 3. STATE MANAGEMENT
// ===================================

let gameData = {
    canvas: null,
    ctx: null,
    width: 0,
    height: 0,
    cx: 0,
    cy: 0,
    scaleFactor: 1,
    frameCount: 0,
    animationFrameId: null,
    lastTimestamp: 0,
    accumulator: 0
};

let gameState = {
    mode: 'IDLE',
    level: 1,
    coins: 0,
    closestDist: Infinity,
    isThrusting: false,
    shakeStrength: 0,
    isPaused: false
};

let physics = {
    bodies: [],
    rocket: null,
    ghostTrail: [],
    particles: [],
    particlePool: [],
    stars: []
};

let upgrades = {};

// ===================================
// 4. CORE FUNCTIONS
// ===================================

function endGame(success, reason) {
    gameState.mode = 'ENDED';
    gameState.isThrusting = false;
    gameState.isPaused = false;
    
    const fuelContainer = document.getElementById('fuelBarContainer');
    if(fuelContainer) fuelContainer.style.display = 'none';
    
    const pauseMenu = document.getElementById('pauseMenu');
    if(pauseMenu) pauseMenu.style.display = 'none';

    // Save ghost trail
    if (physics.rocket && physics.rocket.trail.length > 0) {
        physics.ghostTrail = [...physics.rocket.trail];
    }
    
    // Destroy rocket object to stop physics interactions
    physics.rocket = null;

    const msgTitle = document.getElementById('msgTitle');
    const msgSub = document.getElementById('msgSub');
    const retryBtn = document.getElementById('retryBtn');
    const nextLevelBtn = document.getElementById('nextLevelBtn');
    const message = document.getElementById('message');

    if (success) {
        const earned = GameConfig.LANDING_REWARD;
        gameState.coins += earned;
        msgTitle.innerText = "MARS LANDING!";
        msgTitle.style.color = "#44ff44";
        msgSub.innerText = `+${earned} Coins!`;
        retryBtn.innerText = "Replay Level";
        nextLevelBtn.style.display = "inline-block";
        message.classList.add('success');
        message.classList.remove('failure');
    } else {
        let distScore = Math.max(0, GameConfig.MAX_DISTANCE_SCORE - Math.floor(gameState.closestDist / 2));
        if (reason === 'crashed') distScore = 0;
        gameState.coins += distScore;

        if (reason === 'lost_space') {
            msgTitle.innerText = "LOST IN SPACE";
            msgTitle.style.color = "#ffaa00";
        } else {
            msgTitle.innerText = "CRASHED";
            msgTitle.style.color = "#ff4444";
        }
        msgSub.innerText = `Closest: ${Math.floor(gameState.closestDist)} | Earned: ${distScore} Coins`;
        retryBtn.innerText = "Try Again";
        nextLevelBtn.style.display = "none";
        message.classList.add('failure');
        message.classList.remove('success');
    }

    document.getElementById('coinText').innerText = gameState.coins;
    message.style.display = 'block';
}

function spawnExplosion(x, y, color) {
    gameState.shakeStrength = 10;
    for (let i = 0; i < 30; i++) {
        const p = getPooledParticle(x, y, color);
        physics.particles.push(p);
    }
}

function getPooledParticle(x, y, color) {
    if (physics.particlePool.length > 0) {
        const p = physics.particlePool.pop();
        p.pos.x = x; p.pos.y = y;
        p.vel.x = (Math.random() - 0.5) * 4 * gameData.scaleFactor;
        p.vel.y = (Math.random() - 0.5) * 4 * gameData.scaleFactor;
        p.life = 1;
        p.color = color;
        p.size = (Math.random() * 3 + 1) * gameData.scaleFactor;
        return p;
    }
    return new Particle(x, y, color);
}

// ===================================
// 5. PHYSICS CLASSES
// ===================================

class Vector {
    constructor(x, y) { this.x = x; this.y = y; }
    add(v) { if (v) { this.x += v.x; this.y += v.y; } }
    sub(v) { return new Vector(this.x - v.x, this.y - v.y); }
    mult(n) { this.x *= n; this.y *= n; }
    mag() { return Math.sqrt(this.x * this.x + this.y * this.y); }
    normalize() {
        const m = this.mag();
        if (m !== 0 && Number.isFinite(m)) { this.x /= m; this.y /= m; }
    }
    copy() { return new Vector(this.x, this.y); }
    heading() { return Math.atan2(this.y, this.x); }
}

class Body {
    constructor(x, y, mass, radius, color, isStatic = false, type = 'planet') {
        this.pos = new Vector(x, y);
        this.vel = new Vector(0, 0);
        this.acc = new Vector(0, 0);
        this.mass = mass;
        this.radius = radius * gameData.scaleFactor;
        this.color = color;
        this.isStatic = isStatic;
        this.type = type;
        this.trail = [];
        this.orbitCenter = null;
        this.parentBody = null;
        this.orbitRadius = 0;
        this.orbitAngle = Math.random() * Math.PI * 2;
        this.orbitSpeed = 0;
        this.startPos = new Vector(x, y);
        this.oscillate = false;
        this.oscillateSpeed = 0;
        this.oscillateDist = 0;
        this.timeOffset = 0;
        this.fuel = 0;
        this.angle = 0;
        this.age = 0;
        this.shapeVertices = [];
        
        if (this.type === 'obstacle') {
            const numPoints = 6 + Math.floor(Math.random() * 4);
            for (let i = 0; i < numPoints; i++) {
                const angle = (i / numPoints) * Math.PI * 2;
                const r = this.radius * (0.7 + Math.random() * 0.6);
                this.shapeVertices.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
            }
        }
    }

    applyForce(f) {
        const fCopy = f.copy();
        fCopy.mult(1 / this.mass);
        this.acc.add(fCopy);
    }

    update() {
        if (this.orbitCenter) {
            this.orbitAngle += this.orbitSpeed;
            this.pos.x = this.orbitCenter.x + Math.cos(this.orbitAngle) * this.orbitRadius;
            this.pos.y = this.orbitCenter.y + Math.sin(this.orbitAngle) * this.orbitRadius;
            this.vel.x = -Math.sin(this.orbitAngle) * this.orbitRadius * this.orbitSpeed;
            this.vel.y = Math.cos(this.orbitAngle) * this.orbitRadius * this.orbitSpeed;
        } else if (this.parentBody) {
            this.orbitAngle += this.orbitSpeed;
            this.pos.x = this.parentBody.pos.x + Math.cos(this.orbitAngle) * this.orbitRadius;
            this.pos.y = this.parentBody.pos.y + Math.sin(this.orbitAngle) * this.orbitRadius;
            this.vel.x = this.parentBody.vel.x - Math.sin(this.orbitAngle) * this.orbitRadius * this.orbitSpeed;
            this.vel.y = this.parentBody.vel.y + Math.cos(this.orbitAngle) * this.orbitRadius * this.orbitSpeed;
        } else if (this.oscillate) {
            this.pos.y = this.startPos.y + Math.sin((gameData.frameCount * this.oscillateSpeed) + this.timeOffset) * this.oscillateDist;
        } else if (!this.isStatic) {
            this.vel.add(this.acc);
            this.pos.add(this.vel);
        }
        this.acc.mult(0);
        
        if (this.type === 'rocket') {
            this.age++;
            if (gameState.isThrusting) {
                const target = new Vector(InputManager.mouse.x, InputManager.mouse.y);
                const dir = target.sub(this.pos);
                this.angle = dir.heading();
            } else if (this.vel.mag() > 0.1) {
                this.angle = this.vel.heading();
            }
        }

        if ((this.type === 'planet' || this.type === 'rocket') && gameData.frameCount % 5 === 0) {
            this.trail.push({ x: this.pos.x, y: this.pos.y });
            const limit = this.type === 'rocket' ? GameConfig.ROCKET_TRAIL_LIMIT : GameConfig.BODY_TRAIL_LIMIT;
            if (this.trail.length > limit) this.trail.shift();
        }
    }

    draw() {
        if (!Number.isFinite(this.pos.x) || !Number.isFinite(this.pos.y)) return;
        const ctx = gameData.ctx;

        if ((this.orbitCenter || (this.parentBody && this.type === 'moon')) && this.type !== 'obstacle') {
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 10]);
            if (this.orbitCenter) ctx.arc(this.orbitCenter.x, this.orbitCenter.y, this.orbitRadius, 0, Math.PI * 2);
            else if (this.parentBody) ctx.arc(this.parentBody.pos.x, this.parentBody.pos.y, this.orbitRadius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        if (this.trail.length > 1) {
            ctx.beginPath();
            ctx.strokeStyle = this.type === 'rocket' ? '#fff' : this.color;
            ctx.lineWidth = this.type === 'rocket' ? 1.5 : 1;
            ctx.globalAlpha = 0.3;
            for (let i = 0; i < this.trail.length - 1; i++) {
                ctx.lineTo(this.trail[i].x, this.trail[i].y);
            }
            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        if (this.type === 'rocket') this._drawRocket();
        else if (this.type === 'obstacle') this._drawAsteroid();
        else this._drawPlanet();
    }

    _drawRocket() {
        const ctx = gameData.ctx;
        ctx.save();
        ctx.translate(this.pos.x, this.pos.y);
        ctx.rotate(this.angle);
        ctx.scale(gameData.scaleFactor, gameData.scaleFactor);

        if (gameState.isThrusting && this.fuel > 0) {
            ctx.beginPath();
            ctx.moveTo(-10, -2); ctx.lineTo(-20 - Math.random() * 8, 0); ctx.lineTo(-10, 2);
            ctx.fillStyle = '#ffaa00'; ctx.fill();
        }
        ctx.beginPath();
        ctx.ellipse(0, 0, 10, 4, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#eee'; ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-4, -4); ctx.lineTo(-12, -8); ctx.lineTo(-8, 0); ctx.lineTo(-12, 8); ctx.lineTo(-4, 4);
        ctx.fillStyle = '#cc3333'; ctx.fill();
        ctx.beginPath();
        ctx.ellipse(3, 0, 3, 2, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#00d2ff'; ctx.fill();
        ctx.restore();
    }

    _drawAsteroid() {
        const ctx = gameData.ctx;
        ctx.save();
        ctx.translate(this.pos.x, this.pos.y);
        ctx.rotate(this.orbitAngle * 2 + (gameData.frameCount * 0.01));
        ctx.beginPath();
        ctx.moveTo(this.shapeVertices[0].x, this.shapeVertices[0].y);
        for (let i = 1; i < this.shapeVertices.length; i++) ctx.lineTo(this.shapeVertices[i].x, this.shapeVertices[i].y);
        ctx.closePath();
        ctx.fillStyle = this.color; ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.stroke();
        ctx.restore();
    }

    _drawPlanet() {
        const ctx = gameData.ctx;
        const glowSize = this.radius * 2;
        const g = ctx.createRadialGradient(this.pos.x, this.pos.y, this.radius, this.pos.x, this.pos.y, glowSize);
        g.addColorStop(0, this.color); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = 0.2; ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(this.pos.x, this.pos.y, glowSize, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;

        const grad = ctx.createRadialGradient(this.pos.x - this.radius * 0.3, this.pos.y - this.radius * 0.3, this.radius * 0.1, this.pos.x, this.pos.y, this.radius);
        if (this.type === 'sun') { grad.addColorStop(0, '#fff'); grad.addColorStop(1, '#ff8800'); }
        else if (this.type === 'target_start') { grad.addColorStop(0, '#88ccff'); grad.addColorStop(1, '#0055aa'); }
        else if (this.type === 'target_end') { grad.addColorStop(0, '#ff8888'); grad.addColorStop(1, '#aa2222'); }
        else if (this.type === 'saturn') { grad.addColorStop(0, '#f4d03f'); grad.addColorStop(1, '#b7950b'); }
        else if (this.type === 'moon') { grad.addColorStop(0, '#ddd'); grad.addColorStop(1, '#888'); }
        else { grad.addColorStop(0, '#aaa'); grad.addColorStop(1, '#555'); }
        ctx.beginPath(); ctx.arc(this.pos.x, this.pos.y, this.radius, 0, Math.PI * 2); ctx.fillStyle = grad; ctx.fill();
    }
}

class Particle {
    constructor(x, y, color) {
        this.pos = new Vector(x, y);
        this.vel = new Vector((Math.random() - 0.5) * 4 * gameData.scaleFactor, (Math.random() - 0.5) * 4 * gameData.scaleFactor);
        this.life = 1;
        this.color = color;
        this.size = (Math.random() * 3 + 1) * gameData.scaleFactor;
    }
    update() {
        this.pos.add(this.vel);
        this.life -= 0.03;
    }
}

// ===================================
// 6. MANAGERS
// ===================================

const InputManager = {
    mouse: { x: window.innerWidth / 2, y: window.innerHeight / 2 },

    init() {
        // Correctly handling touch events to allow UI clicks while preventing scroll
        eventManager.on(window, 'mousemove', (e) => this._updateMouse(e));
        eventManager.on(window, 'touchmove', (e) => { e.preventDefault(); this._updateMouse(e); }, { passive: false });
        
        eventManager.on(window, 'mousedown', (e) => this._inputStart(e));
        
        // Critical Mobile Fix: Do NOT prevent default if touching UI elements
        eventManager.on(window, 'touchstart', (e) => { 
            if (this._isTouchingUI(e)) {
                // Allow default behavior (clicking buttons)
            } else {
                e.preventDefault(); 
                this._inputStart(e); 
            }
        }, { passive: false });

        eventManager.on(window, 'mouseup', (e) => this._inputEnd(e));
        eventManager.on(window, 'touchend', (e) => this._inputEnd(e));
    },

    _updateMouse(e) {
        let cx, cy;
        if (e.changedTouches && e.changedTouches.length > 0) {
            cx = e.changedTouches[0].clientX; cy = e.changedTouches[0].clientY;
        } else if (e.clientX !== undefined) {
            cx = e.clientX; cy = e.clientY;
        }
        if (cx !== undefined) { this.mouse.x = cx; this.mouse.y = cy; }
    },

    _isTouchingUI(e) {
        if (!e.target) return false;
        // Check if target is a button, select, or inside a modal/UI container
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT') return true;
        if (e.target.closest('.modal') || e.target.closest('#ui') || e.target.closest('#levelSelectContainer')) return true;
        // Explicit checks for specific buttons if they are direct children
        if (e.target.id === 'storeToggleBtn' || e.target.id === 'resetLevelBtn' || e.target.id === 'pauseBtn') return true;
        return false;
    },

    _inputStart(e) {
        if (this._isTouchingUI(e)) return;
        if (gameState.mode === 'FLYING') {
            gameState.isThrusting = true;
            this._updateMouse(e);
        }
    },

    _inputEnd(e) {
        if (this._isTouchingUI(e)) return;
        if (gameState.mode === 'FLYING') {
            gameState.isThrusting = false;
        } else if (gameState.mode === 'IDLE') {
            launch(e);
        }
    }
};

const UpgradeSystem = {
    upgrades: {},
    init() {
        // Use hardcoded data to ensure offline functionality
        const config = LEVELS_DATA.upgrades;
        this.upgrades = {
            fuel: { level: 1, cost: config.fuel.baseCost, name: config.fuel.name, max: config.fuel.maxLevel, costMultiplier: config.fuel.costMultiplier },
            thrust: { level: 1, cost: config.thrust.baseCost, name: config.thrust.name, max: config.thrust.maxLevel, costMultiplier: config.thrust.costMultiplier },
            launch: { level: 1, cost: config.launch.baseCost, name: config.launch.name, max: config.launch.maxLevel, costMultiplier: config.launch.costMultiplier }
        };
    },
    getStats() {
        return {
            maxFuel: 100 + (this.upgrades.fuel.level - 1) * 30,
            thrustPower: (0.1 + (this.upgrades.thrust.level - 1) * 0.025) * gameData.scaleFactor,
            launchForceMin: 1.5 * gameData.scaleFactor,
            launchForceMax: (5 + (this.upgrades.launch.level - 1)) * gameData.scaleFactor
        };
    },
    buy(type) {
        const u = this.upgrades[type];
        if (u.level < u.max && gameState.coins >= u.cost) {
            gameState.coins -= u.cost;
            u.level++;
            u.cost = Math.floor(u.cost * u.costMultiplier);
            document.getElementById('coinText').innerText = gameState.coins;
            UIManager.renderStore();
        }
    }
};

const UIManager = {
    init() { 
        this.populateLevelSelector();
        this.setupEventListeners(); 
    },
    populateLevelSelector() {
        const sel = document.getElementById('levelSelect');
        sel.innerHTML = '';
        LEVELS_DATA.levels.forEach(l => {
            const opt = document.createElement('option');
            opt.value = l.id; opt.innerText = l.name;
            sel.appendChild(opt);
        });
    },
    setupEventListeners() {
        const el = (id) => document.getElementById(id);
        
        // Helper to bind clicks safely
        const bindClick = (element, handler) => {
            if (element) {
                eventManager.on(element, 'click', (e) => {
                    e.stopPropagation(); // Stop propagation to canvas
                    handler(e);
                });
                // Also prevent touchstart from propagating for buttons
                eventManager.on(element, 'touchstart', (e) => e.stopPropagation(), { passive: true });
            }
        };

        bindClick(el('resetLevelBtn'), () => resetGame('stay'));
        bindClick(el('storeToggleBtn'), () => this.openStore());
        bindClick(el('storeCloseBtn'), () => this.closeStore());
        bindClick(el('pauseBtn'), () => this.togglePause());
        bindClick(el('retryBtn'), () => resetGame('stay'));
        bindClick(el('nextLevelBtn'), () => resetGame('next'));
        
        const lvlSel = el('levelSelect');
        if (lvlSel) {
            eventManager.on(lvlSel, 'change', (e) => changeLevel(e.target.value));
            // Ensure select dropdown works on mobile by stopping propagation
            eventManager.on(lvlSel, 'touchstart', (e) => e.stopPropagation(), { passive: true });
        }

        bindClick(el('pauseResumeBtn'), () => this.togglePause());
        bindClick(el('pauseRestartBtn'), () => { this.togglePause(); resetGame('stay'); });
    },
    openStore() { document.getElementById('storeModal').style.display = 'block'; this.renderStore(); },
    closeStore() { document.getElementById('storeModal').style.display = 'none'; },
    togglePause() {
        if (gameState.mode === 'FLYING') {
            gameState.isPaused = !gameState.isPaused;
            document.getElementById('pauseMenu').style.display = gameState.isPaused ? 'block' : 'none';
            document.getElementById('statusText').innerText = gameState.isPaused ? 'PAUSED' : 'Hold Screen to Thrust!';
        }
    },
    renderStore() {
        const list = document.getElementById('upgradesList');
        while (list.firstChild) list.removeChild(list.firstChild);
        for (const key in UpgradeSystem.upgrades) {
            const u = UpgradeSystem.upgrades[key];
            const row = document.createElement('div'); row.className = 'upgrade-row';
            const info = document.createElement('div'); info.className = 'upgrade-info';
            const name = document.createElement('span'); name.className = 'upgrade-name';
            name.textContent = `${u.name} (Lvl ${u.level})`;
            info.appendChild(name);
            const btn = document.createElement('button'); btn.className = 'buy-btn';
            if (u.level >= u.max) { btn.textContent = 'MAX'; btn.disabled = true; }
            else { btn.textContent = `Buy (${u.cost}c)`; btn.disabled = gameState.coins < u.cost; }
            
            // Bind click for store buttons
            btn.addEventListener('click', (ev) => { 
                ev.stopPropagation(); 
                if (!btn.disabled) buyUpgrade(key); 
            });
            btn.addEventListener('touchstart', (ev) => ev.stopPropagation(), { passive: true });

            row.appendChild(info); row.appendChild(btn); list.appendChild(row);
        }
    }
};

// ===================================
// 7. MAIN LOGIC
// ===================================

function calculateGravity() {
    try {
        if (!physics.rocket) return;
        if (!physics.bodies || physics.bodies.length === 0) return;

        const stats = UpgradeSystem.getStats();
        const localG = GameConfig.G_BASE * gameData.scaleFactor;

        if (gameState.isThrusting && physics.rocket.fuel > 0) {
            const target = new Vector(InputManager.mouse.x, InputManager.mouse.y);
            const force = target.sub(physics.rocket.pos);
            force.normalize();
            force.mult(stats.thrustPower);
            physics.rocket.applyForce(force);
            physics.rocket.fuel -= 0.5;
            if (physics.rocket.fuel < 0) physics.rocket.fuel = 0;

            if (gameData.frameCount % 3 === 0) {
                const p = getPooledParticle(physics.rocket.pos.x, physics.rocket.pos.y, '#ffaa00');
                physics.particles.push(p);
            }
        }

        const fuelBarEl = document.getElementById('fuelBar');
        if (fuelBarEl) {
            const fuelPct = (physics.rocket.fuel / stats.maxFuel) * 100;
            fuelBarEl.style.width = `${fuelPct}%`;
        }

        for (const body of physics.bodies) {
            if (!body || !body.pos) continue;
            if (body.type === 'rocket') continue;
            
            const force = body.pos.sub(physics.rocket.pos);
            let dist = force.mag();
            force.normalize();

            const distClamped = Math.max(dist, 10 * gameData.scaleFactor);
            let strength = (localG * body.mass) / (distClamped * distClamped);
            if (body.type === 'sun') strength *= 1.0; 

            force.mult(strength);
            physics.rocket.applyForce(force);

            const collisionDist = body.radius + (GameConfig.COLLISION_PADDING * gameData.scaleFactor);
            if (dist < collisionDist) {
                const rx = physics.rocket.pos.x;
                const ry = physics.rocket.pos.y;

                if (body.type === 'target_end') {
                    endGame(true, 'landed');
                } else if (body.type === 'target_start') {
                    if (physics.rocket.age > 100) {
                        endGame(false, 'crashed');
                        spawnExplosion(rx, ry, body.color);
                    }
                } else {
                    endGame(false, 'crashed');
                    spawnExplosion(rx, ry, body.color);
                }
                return;
            }
        }

        const mars = physics.bodies.find(b => b.type === 'target_end');
        if (mars && physics.rocket) {
            const d = physics.rocket.pos.sub(mars.pos).mag();
            if (d < gameState.closestDist) {
                gameState.closestDist = d;
                document.getElementById('distanceText').innerText = Math.floor(gameState.closestDist);
            }
        }
    } catch (err) {
        console.error('Gravity Error', err);
    }
}

function getLaunchVector() {
    const earth = physics.bodies.find(b => b.type === 'target_start');
    if (!earth) return { vec: new Vector(0,0), power: 0 };
    const stats = UpgradeSystem.getStats();
    const target = new Vector(InputManager.mouse.x, InputManager.mouse.y);
    const dir = target.sub(earth.pos);
    const dist = dir.mag(); dir.normalize();
    const ratio = Math.min(dist, GameConfig.MAX_INPUT_DIST * gameData.scaleFactor) / (GameConfig.MAX_INPUT_DIST * gameData.scaleFactor);
    const force = stats.launchForceMin + (stats.launchForceMax - stats.launchForceMin) * ratio;
    const launchVel = dir.copy(); launchVel.mult(force);
    if (earth.vel) launchVel.add(earth.vel);
    return { vec: launchVel, power: ratio };
}

function launch(e) {
    const earth = physics.bodies.find(b => b.type === 'target_start');
    if (!earth) return;
    const stats = UpgradeSystem.getStats();
    InputManager._updateMouse(e);
    const { vec } = getLaunchVector();
    physics.rocket = new Body(earth.pos.x, earth.pos.y, 1, 4, '#fff', false, 'rocket');
    physics.rocket.vel = vec;
    physics.rocket.fuel = stats.maxFuel;
    const dir = vec.copy(); dir.normalize();
    const off = dir.copy(); off.mult(earth.radius + (25 * gameData.scaleFactor));
    physics.rocket.pos.add(off);
    gameState.mode = 'FLYING';
    document.getElementById('statusText').innerText = "Hold Screen to Thrust!";
    document.getElementById('statusText').style.color = "#ffaa00";
    document.getElementById('fuelBarContainer').style.display = 'block';
}

function changeLevel(val) { gameState.level = parseInt(val); resetGame('stay'); }

function resetGame(action) {
    if (action === 'reset') { gameState.level = 1; physics.ghostTrail = []; }
    else if (action === 'next') { gameState.level++; physics.ghostTrail = []; if (gameState.level > 4) gameState.level = 1; }
    
    document.getElementById('levelSelect').value = gameState.level;
    document.getElementById('coinText').innerText = gameState.coins;
    gameState.mode = 'IDLE'; gameState.isPaused = false;
    document.getElementById('message').style.display = 'none';
    document.getElementById('pauseMenu').style.display = 'none';
    document.getElementById('nextLevelBtn').style.display = 'none';
    document.getElementById('storeModal').style.display = 'none';
    document.getElementById('fuelBarContainer').style.display = 'none';
    physics.rocket = null; gameState.closestDist = Infinity;
    document.getElementById('distanceText').innerText = "--";
    createSolarSystem();
    gameData.lastTimestamp = performance.now() / 1000; gameData.accumulator = 0;
    document.getElementById('statusText').innerText = "Aim & Drag to Launch";
    document.getElementById('statusText').style.color = "#fff";
}

function createSolarSystem() {
    physics.bodies = [];
    const minDim = Math.min(gameData.width, gameData.height);
    const sun = new Body(gameData.cx, gameData.cy, GameConfig.SUN_MASS, 30, '#ffd700', true, 'sun');
    physics.bodies.push(sun);

    const r1 = minDim * 0.22;
    const earth = new Body(gameData.cx + r1, gameData.cy, GameConfig.EARTH_MASS, 10, '#4facfe', false, 'target_start');
    earth.orbitCenter = new Vector(gameData.cx, gameData.cy);
    earth.orbitRadius = r1; earth.orbitAngle = 0; earth.orbitSpeed = 0.005;
    physics.bodies.push(earth);

    const moonDist = 25 * gameData.scaleFactor;
    const moon = new Body(gameData.cx + r1 + moonDist, gameData.cy, GameConfig.MOON_MASS, 3, '#ccc', false, 'moon');
    moon.parentBody = earth; moon.orbitRadius = moonDist; moon.orbitSpeed = 0.08;
    physics.bodies.push(moon);

    const r2 = minDim * 0.35;
    const mars = new Body(gameData.cx, gameData.cy, GameConfig.MARS_MASS, 9, '#ff5e62', false, 'target_end');
    mars.orbitCenter = new Vector(gameData.cx, gameData.cy);
    mars.orbitRadius = r2; mars.orbitAngle = Math.PI; mars.orbitSpeed = 0.003;
    physics.bodies.push(mars);

    const rSaturn = minDim * 0.48;
    const saturn = new Body(gameData.cx, gameData.cy, GameConfig.SATURN_MASS, 18, '#f4d03f', false, 'saturn');
    saturn.orbitCenter = new Vector(gameData.cx, gameData.cy);
    saturn.orbitRadius = rSaturn; saturn.orbitAngle = Math.PI/2; saturn.orbitSpeed = 0.001;
    physics.bodies.push(saturn);

    for (let i = 0; i < 12; i++) {
        const ring = new Body(0, 0, 5, 2, '#8d6e63', false, 'obstacle');
        ring.parentBody = saturn;
        ring.orbitRadius = (30 * gameData.scaleFactor) + Math.random() * (10 * gameData.scaleFactor);
        ring.orbitAngle = (i/12) * Math.PI*2; ring.orbitSpeed = 0.05 + Math.random() * 0.02;
        physics.bodies.push(ring);
    }

    const levelConfig = LEVELS_DATA.levels[gameState.level - 1];
    let astCount = levelConfig.asteroidCount;
    let minS = levelConfig.asteroidMinSize * gameData.scaleFactor;
    let maxS = levelConfig.asteroidMaxSize * gameData.scaleFactor;

    const zStart = r1 + (30*gameData.scaleFactor), zEnd = r2 - (30*gameData.scaleFactor);
    for (let i = 0; i < astCount; i++) {
        const sz = minS + Math.random()*(maxS-minS);
        const a = new Body(0, 0, 20, sz, '#777', false, 'obstacle');
        a.orbitCenter = new Vector(gameData.cx, gameData.cy);
        a.orbitRadius = zStart + Math.random()*(zEnd-zStart);
        a.orbitAngle = Math.random()*Math.PI*2;
        const spd = 0.002 + Math.random()*0.004;
        a.orbitSpeed = Math.random() > 0.5 ? spd : -spd;
        physics.bodies.push(a);
    }
}

function resize() {
    gameData.width = window.innerWidth; gameData.height = window.innerHeight;
    gameData.canvas.width = gameData.width; gameData.canvas.height = gameData.height;
    gameData.cx = gameData.width/2; gameData.cy = gameData.height/2;
    gameData.scaleFactor = Math.min(gameData.width, gameData.height)/800;
    if (gameData.scaleFactor > 1.2) gameData.scaleFactor = 1.2;
    if (gameData.scaleFactor < 0.6) gameData.scaleFactor = 0.6;
    InputManager.mouse.x = gameData.cx; InputManager.mouse.y = gameData.cy;
    initStars();
    if (gameState.mode === 'IDLE') resetGame('stay');
}

function initStars() {
    physics.stars = [];
    for(let i=0; i<150; i++) physics.stars.push({x: Math.random()*gameData.width, y: Math.random()*gameData.height, size: Math.random()*1.5, alpha: Math.random()*0.8+0.2});
}

function loop() {
    const now = performance.now()/1000;
    if(!gameData.lastTimestamp) gameData.lastTimestamp = now;
    let delta = now - gameData.lastTimestamp;
    if(delta > 0.25) delta = 0.25;
    gameData.lastTimestamp = now; gameData.accumulator += delta;

    if (gameState.isPaused) { gameData.animationFrameId = requestAnimationFrame(loop); return; }

    const ctx = gameData.ctx;
    let sx = 0, sy = 0;
    if(gameState.shakeStrength > 0) {
        sx = (Math.random()-0.5)*gameState.shakeStrength;
        sy = (Math.random()-0.5)*gameState.shakeStrength;
        gameState.shakeStrength *= 0.9;
        if(gameState.shakeStrength < 0.5) gameState.shakeStrength = 0;
    }

    ctx.save(); ctx.translate(sx, sy);
    ctx.fillStyle = '#050510'; ctx.fillRect(-sx, -sy, gameData.width, gameData.height);

    physics.stars.forEach(s => {
        if(Math.random()<0.01) s.alpha = Math.random()*0.8+0.2;
        ctx.fillStyle = `rgba(255,255,255,${s.alpha})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.size, 0, Math.PI*2); ctx.fill();
    });

    const step = 1/60; let steps = 0;
    while(gameData.accumulator >= step && steps < 5) {
        calculateGravity();
        physics.bodies.forEach(b => b.update());
        if(physics.rocket) {
            physics.rocket.update();
            const d = new Vector(physics.rocket.pos.x - gameData.cx, physics.rocket.pos.y - gameData.cy).mag();
            if(d > Math.max(gameData.width, gameData.height)*2) endGame(false, 'lost_space');
        }
        for(let i=physics.particles.length-1; i>=0; i--) {
            const p = physics.particles[i]; p.update();
            if(p.life <= 0) { physics.particlePool.push(p); physics.particles.splice(i, 1); }
        }
        gameData.accumulator -= step; steps++;
    }

    physics.bodies.forEach(b => b.draw());
    
    if(physics.ghostTrail.length > 1) {
        ctx.beginPath(); ctx.strokeStyle = '#00ffff'; ctx.lineWidth = 1*gameData.scaleFactor; ctx.globalAlpha = 0.2;
        ctx.setLineDash([5, 5]);
        physics.ghostTrail.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    }

    if(gameState.mode === 'IDLE') {
        const earth = physics.bodies.find(b => b.type === 'target_start');
        if(earth) {
            const {vec, power} = getLaunchVector();
            ctx.beginPath(); ctx.moveTo(earth.pos.x, earth.pos.y); ctx.lineTo(InputManager.mouse.x, InputManager.mouse.y);
            ctx.strokeStyle = `rgba(255, ${255*(1-power)}, ${255*(1-power)}, 0.4)`;
            ctx.setLineDash([4, 4]); ctx.lineWidth = 1*gameData.scaleFactor; ctx.stroke(); ctx.setLineDash([]);
            
            ctx.beginPath(); ctx.moveTo(earth.pos.x, earth.pos.y);
            let simP = earth.pos.copy();
            const dir = new Vector(InputManager.mouse.x, InputManager.mouse.y).sub(earth.pos);
            dir.normalize(); dir.mult(earth.radius + 20*gameData.scaleFactor);
            simP.add(dir); let simV = vec.copy();
            const lG = GameConfig.G_BASE * gameData.scaleFactor;
            
            for(let i=0; i<15; i++) {
                const sun = physics.bodies.find(b => b.type === 'sun');
                if(!sun) break;
                const f = sun.pos.sub(simP);
                const d = Math.max(f.mag(), 10*gameData.scaleFactor);
                f.normalize(); f.mult((lG * sun.mass * 1.5)/(d*d));
                simV.add(f); simP.add(simV);
                ctx.lineTo(simP.x, simP.y);
            }
            ctx.strokeStyle = 'rgba(0, 210, 255, 0.6)'; ctx.lineWidth = 2*gameData.scaleFactor; ctx.stroke();
        }
    }

    if(physics.rocket) physics.rocket.draw();
    
    physics.particles.forEach(p => {
        ctx.globalAlpha = p.life; ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.rect(p.pos.x - p.size/2, p.pos.y - p.size/2, p.size, p.size); ctx.fill();
    });
    ctx.globalAlpha = 1; ctx.restore();
    gameData.frameCount++;
    gameData.animationFrameId = requestAnimationFrame(loop);
}

// Start
function init() {
    document.getElementById('loadingOverlay').style.display = 'flex';
    gameData.canvas = document.getElementById('gameCanvas');
    gameData.ctx = gameData.canvas.getContext('2d', { alpha: false });
    UpgradeSystem.init();
    InputManager.init();
    UIManager.init();
    eventManager.on(window, 'resize', resize);
    resize(); createSolarSystem();
    document.getElementById('loadingOverlay').style.display = 'none';
    loop();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();