/**
 * MARS SHOT: Orbital Injection
 * A space navigation game featuring gravity-based physics and orbital mechanics
 * 
 * Architecture:
 * - PhysicsEngine: Handles gravity calculations and body updates
 * - GameState: Manages game modes (IDLE, FLYING, ENDED, PAUSED)
 * - InputManager: Centralizes all user input handling
 * - UpgradeSystem: Manages player upgrades and store logic
 * - Renderer: Handles all canvas drawing operations
 * - EventManager: Centralizes event listener management (prevents memory leaks)
 */

// ===================================
// INITIALIZATION & CONFIGURATION
// ===================================

const GameConfig = {
    // Physics Constants
    SUN_MASS: 5000,
    EARTH_MASS: 100,
    MARS_MASS: 80,
    SATURN_MASS: 200,
    MOON_MASS: 10,
    G_BASE: 0.35,
    
    // Game Settings
    MAX_INPUT_DIST: 300,
    ROCKET_TRAIL_LIMIT: 600,
    BODY_TRAIL_LIMIT: 60,
    PREDICTION_STEPS: 15,
    
    // Collision Detection
    COLLISION_PADDING: 4,
    COLLISION_MIN_DIST: 10,
    
    // Scoring
    LANDING_REWARD: 100,
    MAX_DISTANCE_SCORE: 50
};

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
    mode: 'IDLE', // IDLE, FLYING, ENDED, PAUSED
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
let levelsConfig = null;

// ===================================
// EVENT MANAGER - Centralized cleanup
// ===================================

class EventManager {
    constructor() {
        this.events = [];
    }

    on(target, event, handler, options = {}) {
        target.addEventListener(event, handler, options);
        this.events.push({ target, event, handler, options });
    }

    removeAll() {
        this.events.forEach(({ target, event, handler, options }) => {
            target.removeEventListener(event, handler, options);
        });
        this.events = [];
    }
}

const eventManager = new EventManager();

// ===================================
// PHYSICS ENGINE & BODIES
// ===================================

class Vector {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }

    add(v) {
        if (v) {
            this.x += v.x;
            this.y += v.y;
        }
    }

    sub(v) {
        return new Vector(this.x - v.x, this.y - v.y);
    }

    mult(n) {
        this.x *= n;
        this.y *= n;
    }

    mag() {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }

    normalize() {
        const m = this.mag();
        if (m !== 0 && Number.isFinite(m)) {
            this.x /= m;
            this.y /= m;
        }
    }

    copy() {
        return new Vector(this.x, this.y);
    }

    heading() {
        return Math.atan2(this.y, this.x);
    }
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
        
        // Orbital properties
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

        // Rocket-specific properties
        this.fuel = 0;
        this.angle = 0;
        this.age = 0;

        // Asteroid shape
        this.shapeVertices = [];
        if (this.type === 'obstacle') {
            this._generateAsteroidShape();
        }
    }

    _generateAsteroidShape() {
        const numPoints = 6 + Math.floor(Math.random() * 4);
        for (let i = 0; i < numPoints; i++) {
            const angle = (i / numPoints) * Math.PI * 2;
            const r = this.radius * (0.7 + Math.random() * 0.6);
            this.shapeVertices.push({
                x: Math.cos(angle) * r,
                y: Math.sin(angle) * r
            });
        }
    }

    applyForce(f) {
        const fCopy = f.copy();
        fCopy.mult(1 / this.mass);
        this.acc.add(fCopy);
    }

    update() {
        if (this.orbitCenter) {
            // Orbiting a fixed center
            this.orbitAngle += this.orbitSpeed;
            this.pos.x = this.orbitCenter.x + Math.cos(this.orbitAngle) * this.orbitRadius;
            this.pos.y = this.orbitCenter.y + Math.sin(this.orbitAngle) * this.orbitRadius;
            this.vel.x = -Math.sin(this.orbitAngle) * this.orbitRadius * this.orbitSpeed;
            this.vel.y = Math.cos(this.orbitAngle) * this.orbitRadius * this.orbitSpeed;
        } else if (this.parentBody) {
            // Orbiting a moving body
            this.orbitAngle += this.orbitSpeed;
            this.pos.x = this.parentBody.pos.x + Math.cos(this.orbitAngle) * this.orbitRadius;
            this.pos.y = this.parentBody.pos.y + Math.sin(this.orbitAngle) * this.orbitRadius;
            this.vel.x = this.parentBody.vel.x - Math.sin(this.orbitAngle) * this.orbitRadius * this.orbitSpeed;
            this.vel.y = this.parentBody.vel.y + Math.cos(this.orbitAngle) * this.orbitRadius * this.orbitSpeed;
        } else if (this.oscillate) {
            this.pos.y = this.startPos.y + Math.sin((gameData.frameCount * this.oscillateSpeed) + this.timeOffset) * this.oscillateDist;
        } else if (!this.isStatic) {
            // Free-floating bodies under gravity
            this.vel.add(this.acc);
            this.pos.add(this.vel);
        }
        
        this.acc.mult(0);
        
        // Rocket-specific updates
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

        // Trail management
        if ((this.type === 'planet' || this.type === 'rocket') && gameData.frameCount % 5 === 0) {
            this.trail.push({ x: this.pos.x, y: this.pos.y });
            const limit = this.type === 'rocket' ? GameConfig.ROCKET_TRAIL_LIMIT : GameConfig.BODY_TRAIL_LIMIT;
            if (this.trail.length > limit) {
                this.trail.shift();
            }
        }
    }

    draw() {
        if (!Number.isFinite(this.pos.x) || !Number.isFinite(this.pos.y)) return;

        const ctx = gameData.ctx;

        // Draw orbit lines
        if ((this.orbitCenter || (this.parentBody && this.type === 'moon')) && this.type !== 'obstacle') {
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 10]);
            if (this.orbitCenter) {
                ctx.arc(this.orbitCenter.x, this.orbitCenter.y, this.orbitRadius, 0, Math.PI * 2);
            } else if (this.parentBody) {
                ctx.arc(this.parentBody.pos.x, this.parentBody.pos.y, this.orbitRadius, 0, Math.PI * 2);
            }
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Draw trail
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

        if (this.type === 'rocket') {
            this._drawRocket();
        } else if (this.type === 'obstacle') {
            this._drawAsteroid();
        } else {
            this._drawPlanet();
        }
    }

    _drawRocket() {
        const ctx = gameData.ctx;
        ctx.save();
        ctx.translate(this.pos.x, this.pos.y);
        ctx.rotate(this.angle);
        ctx.scale(gameData.scaleFactor, gameData.scaleFactor);

        // Thruster flame
        if (gameState.isThrusting && this.fuel > 0) {
            ctx.beginPath();
            ctx.moveTo(-10, -2);
            ctx.lineTo(-20 - Math.random() * 8, 0);
            ctx.lineTo(-10, 2);
            ctx.fillStyle = '#ffaa00';
            ctx.fill();
        }

        // Main body
        ctx.beginPath();
        ctx.ellipse(0, 0, 10, 4, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#eee';
        ctx.fill();

        // Fins
        ctx.beginPath();
        ctx.moveTo(-4, -4);
        ctx.lineTo(-12, -8);
        ctx.lineTo(-8, 0);
        ctx.lineTo(-12, 8);
        ctx.lineTo(-4, 4);
        ctx.fillStyle = '#cc3333';
        ctx.fill();

        // Window
        ctx.beginPath();
        ctx.ellipse(3, 0, 3, 2, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#00d2ff';
        ctx.fill();
        
        ctx.restore();
    }

    _drawAsteroid() {
        const ctx = gameData.ctx;
        ctx.save();
        ctx.translate(this.pos.x, this.pos.y);
        ctx.rotate(this.orbitAngle * 2);
        ctx.beginPath();
        ctx.moveTo(this.shapeVertices[0].x, this.shapeVertices[0].y);
        for (let i = 1; i < this.shapeVertices.length; i++) {
            ctx.lineTo(this.shapeVertices[i].x, this.shapeVertices[i].y);
        }
        ctx.closePath();
        ctx.fillStyle = this.color;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.stroke();
        ctx.restore();
    }

    _drawPlanet() {
        const ctx = gameData.ctx;
        
        // Glow effect for special bodies
        if (this.type === 'sun' || this.type === 'target_start' || this.type === 'target_end' || this.type === 'saturn') {
            const glowSize = this.radius * 2;
            const g = ctx.createRadialGradient(this.pos.x, this.pos.y, this.radius, this.pos.x, this.pos.y, glowSize);
            g.addColorStop(0, this.color);
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.globalAlpha = 0.2;
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(this.pos.x, this.pos.y, glowSize, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
        }

        // Main sphere with gradient
        const grad = ctx.createRadialGradient(
            this.pos.x - this.radius * 0.3, this.pos.y - this.radius * 0.3, this.radius * 0.1,
            this.pos.x, this.pos.y, this.radius
        );

        if (this.type === 'sun') {
            grad.addColorStop(0, '#fff');
            grad.addColorStop(1, '#ff8800');
            ctx.shadowBlur = 40;
            ctx.shadowColor = '#ff8800';
        } else if (this.type === 'target_start') {
            grad.addColorStop(0, '#88ccff');
            grad.addColorStop(1, '#0055aa');
        } else if (this.type === 'target_end') {
            grad.addColorStop(0, '#ff8888');
            grad.addColorStop(1, '#aa2222');
        } else if (this.type === 'saturn') {
            grad.addColorStop(0, '#f4d03f');
            grad.addColorStop(1, '#b7950b');
        } else if (this.type === 'moon') {
            grad.addColorStop(0, '#ddd');
            grad.addColorStop(1, '#888');
        } else {
            grad.addColorStop(0, '#aaa');
            grad.addColorStop(1, '#555');
        }

        ctx.beginPath();
        ctx.arc(this.pos.x, this.pos.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.shadowBlur = 0;
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

    draw() {
        const ctx = gameData.ctx;
        ctx.globalAlpha = this.life;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.pos.x, this.pos.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }
}

// ===================================
// PHYSICS CALCULATIONS
// ===================================

function calculateGravity() {
    try {
        // If there's no rocket or no bodies, nothing to calculate
        if (!physics.rocket) return;
        if (!physics.bodies || physics.bodies.length === 0) {
            // No bodies yet (maybe still initializing) — skip gravity calculations
            return;
        }

        const stats = UpgradeSystem.getStats();
    const localG = GameConfig.G_BASE * gameData.scaleFactor;

    // Thrust application
    if (gameState.isThrusting && physics.rocket.fuel > 0) {
        const target = new Vector(InputManager.mouse.x, InputManager.mouse.y);
        const force = target.sub(physics.rocket.pos);
        force.normalize();
        force.mult(stats.thrustPower);
        physics.rocket.applyForce(force);
        physics.rocket.fuel -= 0.5;
        if (physics.rocket.fuel < 0) physics.rocket.fuel = 0;

        // Exhaust particles
        if (gameData.frameCount % 3 === 0) {
            // Use particle pool to reduce allocations
            const p = getPooledParticle(physics.rocket.pos.x, physics.rocket.pos.y, '#ffaa00');
            physics.particles.push(p);
        }
    }

    // Update fuel bar (safely)
    try {
        const fuelBarEl = document.getElementById('fuelBar');
        if (fuelBarEl && typeof physics.rocket.fuel === 'number') {
            const fuelPct = (physics.rocket.fuel / stats.maxFuel) * 100;
            fuelBarEl.style.width = `${fuelPct}%`;
        }
    } catch (e) {
        console.debug('Failed to update fuel bar:', e);
    }

    // Gravity from all bodies
    for (const body of physics.bodies) {
        if (!body || !body.pos) continue;
        if (body.type === 'rocket') continue;

        // Guard against rocket being removed mid-loop
        if (!physics.rocket || !physics.rocket.pos) continue;

        const force = body.pos.sub(physics.rocket.pos);
        let dist = force.mag();
        force.normalize();

        // Clamp distance to prevent infinite forces
        const distClamped = Math.max(dist, GameConfig.COLLISION_MIN_DIST * gameData.scaleFactor);
        const strength = (localG * body.mass) / (distClamped * distClamped);
        
        // Boost sun's gravity at distance for gameplay balance
        if (body.type === 'sun') {
            force.mult(strength * 1.5);
        } else {
            force.mult(strength);
        }
        physics.rocket.applyForce(force);

        // Collision detection
        const collisionDist = body.radius + (GameConfig.COLLISION_PADDING * gameData.scaleFactor);
        if (dist < collisionDist) {
            if (body.type === 'target_end') {
                endGame(true, 'landed');
            } else if (body.type === 'target_start' && physics.rocket.age <= 100) {
                // Safe takeoff zone
                return;
            } else {
                endGame(false, 'crashed');
            }
                // safe explosion spawn
                if (physics.rocket && physics.rocket.pos) {
                    spawnExplosion(physics.rocket.pos.x, physics.rocket.pos.y, body.color);
                }
            physics.rocket = null;
            return;
        }
    }

        // Update closest distance to Mars
        const mars = physics.bodies.find(b => b.type === 'target_end');
        if (mars && physics.rocket) {
            const d = physics.rocket.pos.sub(mars.pos).mag();
            if (d < gameState.closestDist) {
                gameState.closestDist = d;
                document.getElementById('distanceText').innerText = Math.floor(gameState.closestDist);
            }
        }
    } catch (err) {
        console.error('calculateGravity error:', err);
        console.log('physics.rocket:', physics.rocket);
        console.log('physics.bodies:', physics.bodies && physics.bodies.map(b => b ? b.type : b));
        return;
    }
}

function spawnExplosion(x, y, color) {
    gameState.shakeStrength = 10;
    for (let i = 0; i < 30; i++) {
        const p = getPooledParticle(x, y, color);
        physics.particles.push(p);
    }
}

// Simple particle pooling
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
// INPUT MANAGER
// ===================================

const InputManager = {
    mouse: { x: window.innerWidth / 2, y: window.innerHeight / 2 },

    init() {
        eventManager.on(window, 'mousemove', (e) => this._updateMouse(e));
        eventManager.on(window, 'touchmove', (e) => { e.preventDefault(); this._updateMouse(e); }, { passive: false });
        eventManager.on(window, 'mousedown', (e) => this._inputStart(e));
        eventManager.on(window, 'touchstart', (e) => { e.preventDefault(); this._inputStart(e); }, { passive: false });
        eventManager.on(window, 'mouseup', (e) => this._inputEnd(e));
        eventManager.on(window, 'touchend', (e) => this._inputEnd(e));
    },

    _updateMouse(e) {
        let clientX, clientY;
        if (e.changedTouches && e.changedTouches.length > 0) {
            clientX = e.changedTouches[0].clientX;
            clientY = e.changedTouches[0].clientY;
        } else if (e.clientX !== undefined) {
            clientX = e.clientX;
            clientY = e.clientY;
        }
        
        if (clientX !== undefined) {
            this.mouse.x = clientX;
            this.mouse.y = clientY;
        }
    },

    _inputStart(e) {
        if (gameState.mode === 'FLYING') {
            gameState.isThrusting = true;
            this._updateMouse(e);
        }
    },

    _inputEnd(e) {
        if (gameState.mode === 'FLYING') {
            gameState.isThrusting = false;
        } else if (gameState.mode === 'IDLE') {
            const storeModal = document.getElementById('storeModal');
            const pauseMenu = document.getElementById('pauseMenu');
            if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'SELECT' && 
                !storeModal.contains(e.target) && !pauseMenu.contains(e.target)) {
                launch(e);
            }
        }
    }
};

// ===================================
// UPGRADE SYSTEM
// ===================================

const UpgradeSystem = {
    upgrades: {},

    async init() {
        try {
            const response = await fetch('levels.json');
            levelsConfig = await response.json();
            this.initUpgrades();
        } catch (error) {
            console.error('Failed to load configuration:', error);
            this.initUpgradesFromDefaults();
        }
    },

    initUpgrades() {
        const config = levelsConfig.upgrades;
        this.upgrades = {
            fuel: {
                level: 1,
                cost: config.fuel.baseCost,
                name: config.fuel.name,
                max: config.fuel.maxLevel,
                costMultiplier: config.fuel.costMultiplier
            },
            thrust: {
                level: 1,
                cost: config.thrust.baseCost,
                name: config.thrust.name,
                max: config.thrust.maxLevel,
                costMultiplier: config.thrust.costMultiplier
            },
            launch: {
                level: 1,
                cost: config.launch.baseCost,
                name: config.launch.name,
                max: config.launch.maxLevel,
                costMultiplier: config.launch.costMultiplier
            }
        };
        upgrades = this.upgrades;
    },

    initUpgradesFromDefaults() {
        // Fallback if JSON fails to load
        this.upgrades = {
            fuel: { level: 1, cost: 50, name: "Fuel Tank", max: 5, costMultiplier: 1.5 },
            thrust: { level: 1, cost: 80, name: "Ion Engine", max: 5, costMultiplier: 1.5 },
            launch: { level: 1, cost: 60, name: "Catapult", max: 5, costMultiplier: 1.5 }
        };
        upgrades = this.upgrades;
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

// ===================================
// UI MANAGER
// ===================================

const UIManager = {
    async init() {
        await this.loadConfig();
        this.setupEventListeners();
    },

    async loadConfig() {
        try {
            const response = await fetch('levels.json');
            levelsConfig = await response.json();
            this.populateLevelSelector();
        } catch (error) {
            console.error('Failed to load level config:', error);
        }
    },

    populateLevelSelector() {
        const levelSelect = document.getElementById('levelSelect');
        levelSelect.innerHTML = '';
        if (levelsConfig) {
            levelsConfig.levels.forEach(level => {
                const option = document.createElement('option');
                option.value = level.id;
                option.innerText = level.name;
                levelSelect.appendChild(option);
            });
        }
    },

    setupEventListeners() {
        const resetLevelBtn = document.getElementById('resetLevelBtn');
        const storeToggleBtn = document.getElementById('storeToggleBtn');
        const storeCloseBtn = document.getElementById('storeCloseBtn');
        const pauseBtn = document.getElementById('pauseBtn');
        const retryBtn = document.getElementById('retryBtn');
        const nextLevelBtn = document.getElementById('nextLevelBtn');
        const levelSelect = document.getElementById('levelSelect');
        const pauseResumeBtn = document.getElementById('pauseResumeBtn');
        const pauseRestartBtn = document.getElementById('pauseRestartBtn');

        eventManager.on(resetLevelBtn, 'click', () => resetGame('stay'));
        eventManager.on(storeToggleBtn, 'click', (e) => { e.stopPropagation(); this.openStore(); });
        eventManager.on(storeCloseBtn, 'click', () => this.closeStore());
        eventManager.on(pauseBtn, 'click', () => this.togglePause());
        eventManager.on(retryBtn, 'click', () => resetGame('stay'));
        eventManager.on(nextLevelBtn, 'click', () => resetGame('next'));
        eventManager.on(levelSelect, 'change', (e) => changeLevel(e.target.value));
        eventManager.on(pauseResumeBtn, 'click', () => this.togglePause());
        eventManager.on(pauseRestartBtn, 'click', () => { this.togglePause(); resetGame('stay'); });
    },

    openStore() {
        document.getElementById('storeModal').style.display = 'block';
        this.renderStore();
    },

    closeStore() {
        document.getElementById('storeModal').style.display = 'none';
    },

    togglePause() {
        if (gameState.mode === 'FLYING') {
            gameState.isPaused = !gameState.isPaused;
            document.getElementById('pauseMenu').style.display = gameState.isPaused ? 'block' : 'none';
            document.getElementById('statusText').innerText = gameState.isPaused ? 'PAUSED' : 'Hold Screen to Thrust!';
        }
    },

    renderStore() {
        const upgradesList = document.getElementById('upgradesList');
        // Clear existing children safely
        while (upgradesList.firstChild) upgradesList.removeChild(upgradesList.firstChild);

        for (const key in UpgradeSystem.upgrades) {
            const u = UpgradeSystem.upgrades[key];
            const row = document.createElement('div');
            row.className = 'upgrade-row';

            const info = document.createElement('div');
            info.className = 'upgrade-info';
            const name = document.createElement('span');
            name.className = 'upgrade-name';
            name.textContent = `${u.name} (Lvl ${u.level})`;
            info.appendChild(name);

            const btn = document.createElement('button');
            btn.className = 'buy-btn';
            if (u.level >= u.max) {
                btn.textContent = 'MAX';
                btn.disabled = true;
            } else {
                btn.textContent = `Buy (${u.cost}c)`;
                btn.disabled = gameState.coins < u.cost;
            }

            // Attach event listener
            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                if (!btn.disabled) {
                    buyUpgrade(key);
                }
            });

            row.appendChild(info);
            row.appendChild(btn);
            upgradesList.appendChild(row);
        }
    }
};

// ===================================
// GAME LOGIC
// ===================================

function changeLevel(val) {
    gameState.level = parseInt(val);
    resetGame('stay');
}

function resetGame(action) {
    if (action === 'reset') {
        gameState.level = 1;
        physics.ghostTrail = [];
    } else if (action === 'next') {
        gameState.level++;
        physics.ghostTrail = [];
        if (gameState.level > 4) gameState.level = 1;
    }

    document.getElementById('levelSelect').value = gameState.level;
    document.getElementById('coinText').innerText = gameState.coins;

    gameState.mode = 'IDLE';
    gameState.isPaused = false;
    document.getElementById('message').style.display = 'none';
    document.getElementById('pauseMenu').style.display = 'none';
    document.getElementById('nextLevelBtn').style.display = 'none';
    document.getElementById('storeModal').style.display = 'none';
    document.getElementById('fuelBarContainer').style.display = 'none';

    physics.rocket = null;
    gameState.closestDist = Infinity;
    document.getElementById('distanceText').innerText = "--";

    createSolarSystem();
    // Log reset for debugging
    console.log('resetGame()', { action, width: gameData.width, height: gameData.height });

    // Reset timing accumulator so the fixed-step loop doesn't try to consume a large delta
    gameData.lastTimestamp = performance.now() / 1000;
    gameData.accumulator = 0;

    console.log('after createSolarSystem bodies:', physics.bodies.map(b => b ? b.type : b));
    document.getElementById('statusText').innerText = "Aim & Drag to Launch";
    document.getElementById('statusText').style.color = "#fff";
}

function createSolarSystem() {
    physics.bodies = [];
    const minDim = Math.min(gameData.width, gameData.height);

    // Sun
    const sun = new Body(gameData.cx, gameData.cy, GameConfig.SUN_MASS, 30, '#ffd700', true, 'sun');
    physics.bodies.push(sun);

    // Earth (start position)
    const r1 = minDim * 0.22;
    const earth = new Body(gameData.cx + r1, gameData.cy, GameConfig.EARTH_MASS, 10, '#4facfe', false, 'target_start');
    earth.orbitCenter = new Vector(gameData.cx, gameData.cy);
    earth.orbitRadius = r1;
    earth.orbitAngle = 0;
    earth.orbitSpeed = 0.005;
    physics.bodies.push(earth);

    // Moon
    const moonDist = 25 * gameData.scaleFactor;
    const moon = new Body(gameData.cx + r1 + moonDist, gameData.cy, GameConfig.MOON_MASS, 3, '#ccc', false, 'moon');
    moon.parentBody = earth;
    moon.orbitRadius = moonDist;
    moon.orbitSpeed = 0.08;
    physics.bodies.push(moon);

    // Mars (target)
    const r2 = minDim * 0.35;
    const mars = new Body(gameData.cx, gameData.cy, GameConfig.MARS_MASS, 9, '#ff5e62', false, 'target_end');
    mars.orbitCenter = new Vector(gameData.cx, gameData.cy);
    mars.orbitRadius = r2;
    mars.orbitAngle = Math.PI;
    mars.orbitSpeed = 0.003;
    physics.bodies.push(mars);

    // Saturn
    const rSaturn = minDim * 0.48;
    const saturn = new Body(gameData.cx, gameData.cy, GameConfig.SATURN_MASS, 18, '#f4d03f', false, 'saturn');
    saturn.orbitCenter = new Vector(gameData.cx, gameData.cy);
    saturn.orbitRadius = rSaturn;
    saturn.orbitAngle = Math.PI / 2;
    saturn.orbitSpeed = 0.001;
    physics.bodies.push(saturn);

    // Saturn's rings
    const ringCount = 12;
    for (let i = 0; i < ringCount; i++) {
        const ringRock = new Body(0, 0, 5, 2, '#8d6e63', false, 'obstacle');
        ringRock.parentBody = saturn;
        ringRock.orbitRadius = (30 * gameData.scaleFactor) + Math.random() * (10 * gameData.scaleFactor);
        ringRock.orbitAngle = (i / ringCount) * Math.PI * 2;
        ringRock.orbitSpeed = 0.05 + Math.random() * 0.02;
        physics.bodies.push(ringRock);
    }

    // Asteroids
    const levelConfig = levelsConfig ? levelsConfig.levels[gameState.level - 1] : null;
    let asteroidCount = levelConfig ? levelConfig.asteroidCount : 3;
    let minSize = levelConfig ? levelConfig.asteroidMinSize : 6;
    let maxSize = levelConfig ? levelConfig.asteroidMaxSize : 10;
    let orbitZoneEnd = r2 - (30 * gameData.scaleFactor);

    if (gameState.level === 4) {
        orbitZoneEnd = rSaturn - (30 * gameData.scaleFactor);
    }

    const orbitZoneStart = r1 + (30 * gameData.scaleFactor);

    for (let i = 0; i < asteroidCount; i++) {
        const size = minSize + Math.random() * (maxSize - minSize);
        const asteroid = new Body(0, 0, 20, size, '#777', false, 'obstacle');
        asteroid.orbitCenter = new Vector(gameData.cx, gameData.cy);
        asteroid.orbitRadius = orbitZoneStart + Math.random() * (orbitZoneEnd - orbitZoneStart);
        asteroid.orbitAngle = Math.random() * Math.PI * 2;
        const speed = 0.002 + Math.random() * 0.004;
        asteroid.orbitSpeed = Math.random() > 0.5 ? speed : -speed;
        physics.bodies.push(asteroid);
    }

    // Debug: log the types of bodies created
    try {
        console.log('createSolarSystem: bodies created ->', physics.bodies.map(b => b.type));
    } catch (e) {
        console.log('createSolarSystem: error listing bodies', e);
    }
}

function getLaunchVector() {
    const earth = physics.bodies.find(b => b.type === 'target_start');
    if (!earth) return { vec: new Vector(0, 0), power: 0 };

    const stats = UpgradeSystem.getStats();
    const target = new Vector(InputManager.mouse.x, InputManager.mouse.y);
    const dir = target.sub(earth.pos);
    const dist = dir.mag();
    dir.normalize();

    const powerRatio = Math.min(dist, GameConfig.MAX_INPUT_DIST * gameData.scaleFactor) / (GameConfig.MAX_INPUT_DIST * gameData.scaleFactor);
    const force = stats.launchForceMin + (stats.launchForceMax - stats.launchForceMin) * powerRatio;

    const launchVel = dir.copy();
    launchVel.mult(force);

    if (earth.vel) {
        launchVel.add(earth.vel);
    }

    return { vec: launchVel, power: powerRatio };
}

function launch(e) {
    const earth = physics.bodies.find(b => b.type === 'target_start');
    const stats = UpgradeSystem.getStats();

    InputManager._updateMouse(e);
    const { vec } = getLaunchVector();

    physics.rocket = new Body(earth.pos.x, earth.pos.y, 1, 4, '#fff', false, 'rocket');
    physics.rocket.vel = vec;
    physics.rocket.fuel = stats.maxFuel;

    const dir = vec.copy();
    dir.normalize();
    const spawnOffset = dir.copy();
    spawnOffset.mult(earth.radius + (25 * gameData.scaleFactor));
    physics.rocket.pos.add(spawnOffset);

    gameState.mode = 'FLYING';
    document.getElementById('statusText').innerText = "Hold Screen to Thrust!";
    document.getElementById('statusText').style.color = "#ffaa00";
    document.getElementById('fuelBarContainer').style.display = 'block';
}

function endGame(success, reason) {
    gameState.mode = 'ENDED';
    gameState.isThrusting = false;
    gameState.isPaused = false;
    document.getElementById('fuelBarContainer').style.display = 'none';
    document.getElementById('pauseMenu').style.display = 'none';

    const endRocketTrail = physics.rocket ? [...physics.rocket.trail] : [];
    physics.rocket = null;
    if (endRocketTrail.length > 0) {
        physics.ghostTrail = endRocketTrail;
    }

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

function buyUpgrade(type) {
    UpgradeSystem.buy(type);
}

// ===================================
// INITIALIZATION & RENDERING
// ===================================

function resize() {
    gameData.width = window.innerWidth;
    gameData.height = window.innerHeight;
    gameData.canvas.width = gameData.width;
    gameData.canvas.height = gameData.height;
    gameData.cx = gameData.width / 2;
    gameData.cy = gameData.height / 2;

    // Adaptive scaling
    gameData.scaleFactor = Math.min(gameData.width, gameData.height) / 800;
    if (gameData.scaleFactor > 1.2) gameData.scaleFactor = 1.2;
    if (gameData.scaleFactor < 0.6) gameData.scaleFactor = 0.6;

    InputManager.mouse.x = gameData.cx;
    InputManager.mouse.y = gameData.cy;

    initStars();
    if (gameState.mode === 'IDLE' || gameState.mode === 'PAUSED') {
        resetGame('stay');
    }
}

function initStars() {
    physics.stars = [];
    for (let i = 0; i < 150; i++) {
        physics.stars.push({
            x: Math.random() * gameData.width,
            y: Math.random() * gameData.height,
            size: Math.random() * 1.5,
            alpha: Math.random() * 0.8 + 0.2
        });
    }
}

function loop() {
    const now = performance.now() / 1000; // seconds
    if (!gameData.lastTimestamp) gameData.lastTimestamp = now;
    let delta = now - gameData.lastTimestamp;
    // Clamp delta to avoid huge jumps
    if (delta > 0.25) delta = 0.25;
    gameData.lastTimestamp = now;
    gameData.accumulator += delta;

    if (gameState.isPaused) {
        renderFrame();
        gameData.animationFrameId = requestAnimationFrame(loop);
        return;
    }

    // Apply screen shake
    let shakeX = 0, shakeY = 0;
    if (gameState.shakeStrength > 0) {
        shakeX = (Math.random() - 0.5) * gameState.shakeStrength;
        shakeY = (Math.random() - 0.5) * gameState.shakeStrength;
        gameState.shakeStrength *= 0.9;
        if (gameState.shakeStrength < 0.5) gameState.shakeStrength = 0;
    }

    gameData.ctx.save();
    gameData.ctx.translate(shakeX, shakeY);

    // Clear canvas
    gameData.ctx.fillStyle = '#050510';
    gameData.ctx.fillRect(-shakeX, -shakeY, gameData.width, gameData.height);

    // Draw stars
    for (const s of physics.stars) {
        if (Math.random() < 0.01) s.alpha = Math.random() * 0.8 + 0.2;
        gameData.ctx.fillStyle = `rgba(255, 255, 255, ${s.alpha})`;
        gameData.ctx.beginPath();
        gameData.ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        gameData.ctx.fill();
    }

    // Physics steps: use fixed timestep integration for stability
    const FIXED_STEP = 1 / 60; // seconds
    const maxSteps = 5; // avoid spiral of death
    let steps = 0;
    while (gameData.accumulator >= FIXED_STEP && steps < maxSteps) {
        physicsStep(FIXED_STEP);
        gameData.accumulator -= FIXED_STEP;
        steps++;
    }

    // Render everything
    render();

    gameData.ctx.restore();

    renderFrame();
    gameData.animationFrameId = requestAnimationFrame(loop);
}

function renderFrame() {
    // Additional rendering logic can go here if needed
}

// Perform a single fixed physics step (dt in seconds)
function physicsStep(dt) {
    // Update gravity/thrust and bodies
    // Note: calculateGravity expects to operate per-step
    calculateGravity();

    for (const b of physics.bodies) {
        b.update();
    }

    // Update rocket separately for age and other per-step logic
    if (physics.rocket) {
        physics.rocket.update();
        const centerDist = new Vector(physics.rocket.pos.x - gameData.cx, physics.rocket.pos.y - gameData.cy).mag();
        if (centerDist > Math.max(gameData.width, gameData.height) * 2) {
            endGame(false, 'lost_space');
        }
    }

    // Update particles and recycle any dead ones
    for (let i = physics.particles.length - 1; i >= 0; i--) {
        const p = physics.particles[i];
        p.update();
        if (p.life <= 0) {
            // recycle
            physics.particlePool.push(p);
            physics.particles.splice(i, 1);
        }
    }
}

// Draw everything to the canvas
function render() {
    const ctx = gameData.ctx;

    // Draw bodies
    for (const b of physics.bodies) {
        b.draw();
    }

    // Draw ghost trail
    if (physics.ghostTrail.length > 1) {
        ctx.beginPath();
        ctx.strokeStyle = '#00ffff';
        ctx.lineWidth = 1 * gameData.scaleFactor;
        ctx.globalAlpha = 0.2;
        ctx.setLineDash([5, 5]);
        for (let i = 0; i < physics.ghostTrail.length - 1; i++) {
            ctx.lineTo(physics.ghostTrail[i].x, physics.ghostTrail[i].y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
    }

    // Draw launch prediction
    if (gameState.mode === 'IDLE') {
        const earth = physics.bodies.find(b => b.type === 'target_start');
        if (earth) {
            const { vec, power } = getLaunchVector();

            // Aiming line
            ctx.beginPath();
            ctx.moveTo(earth.pos.x, earth.pos.y);
            ctx.lineTo(InputManager.mouse.x, InputManager.mouse.y);
            ctx.strokeStyle = `rgba(255, ${255 * (1 - power)}, ${255 * (1 - power)}, 0.4)`;
            ctx.setLineDash([4, 4]);
            ctx.lineWidth = 1 * gameData.scaleFactor;
            ctx.stroke();
            ctx.setLineDash([]);

            // Trajectory prediction
            ctx.beginPath();
            ctx.moveTo(earth.pos.x, earth.pos.y);
            let simPos = earth.pos.copy();
            const dir = new Vector(InputManager.mouse.x, InputManager.mouse.y).sub(earth.pos);
            dir.normalize();
            dir.mult(earth.radius + (20 * gameData.scaleFactor));
            simPos.add(dir);
            let simVel = vec.copy();

            const localG = GameConfig.G_BASE * gameData.scaleFactor;
            for (let i = 0; i < GameConfig.PREDICTION_STEPS; i++) {
                const sun = physics.bodies.find(b => b.type === 'sun');
                if (!sun) break;
                const f = sun.pos.sub(simPos);
                const d = f.mag();
                const dClamped = Math.max(d, GameConfig.COLLISION_MIN_DIST * gameData.scaleFactor);
                f.normalize();
                const s = (localG * sun.mass * 1.5) / (dClamped * dClamped);
                f.mult(s);
                simVel.add(f);
                simPos.add(simVel);
                ctx.lineTo(simPos.x, simPos.y);
            }
            ctx.strokeStyle = 'rgba(0, 210, 255, 0.6)';
            ctx.lineWidth = 2 * gameData.scaleFactor;
            ctx.stroke();
        }
    }

    // Draw rocket (on top)
    if (physics.rocket) {
        physics.rocket.draw();
    }

    // Draw particles
    for (let i = 0; i < physics.particles.length; i++) {
        physics.particles[i].draw();
    }

    gameData.frameCount++;
}

// ===================================
// MAIN INITIALIZATION
// ===================================

async function init() {
    // Show loading screen
    document.getElementById('loadingOverlay').style.display = 'flex';

    gameData.canvas = document.getElementById('gameCanvas');
    gameData.ctx = gameData.canvas.getContext('2d');

    // Initialize managers
    await UpgradeSystem.init();
    InputManager.init();
    await UIManager.init();

    // Setup window listeners
    eventManager.on(window, 'resize', resize);

    // Start game
    resize();
    createSolarSystem();

    // Hide loading screen
    document.getElementById('loadingOverlay').style.display = 'none';

    // Visibility and unload handlers
    eventManager.on(document, 'visibilitychange', () => {
        if (document.hidden) {
            if (gameState.mode === 'FLYING') {
                gameState.isPaused = true;
                document.getElementById('pauseMenu').style.display = 'block';
                document.getElementById('statusText').innerText = 'PAUSED';
            }
        } else {
            if (gameState.mode === 'FLYING' && gameState.isPaused) {
                gameState.isPaused = false;
                document.getElementById('pauseMenu').style.display = 'none';
                document.getElementById('statusText').innerText = 'Hold Screen to Thrust!';
            }
        }
    });

    eventManager.on(window, 'beforeunload', () => {
        if (gameData.animationFrameId) cancelAnimationFrame(gameData.animationFrameId);
        eventManager.removeAll();
    });

    // Start game loop
    loop();
}

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
