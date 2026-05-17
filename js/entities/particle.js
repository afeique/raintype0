// All particle variants share one class. The type tag selects the
// reset / update / draw behaviour. Preserves the monosrc vocabulary
// 1:1 — every particle type the player can see is here.

import { random } from '../core/utils.js';

export class Particle {
    constructor() { this.active = false; }

    reset(x, y, type, ...args) {
        this.x = x;
        this.y = y;
        this.type = type;
        this.active = true;

        switch (type) {
            case 'explosion': {
                this.radius = random(1, 3);
                this.vel = { x: random(-3, 3), y: random(-3, 3) };
                this.life = 1;
                this.color = `hsl(${random(0, 360) | 0},100%,70%)`;
                break;
            }
            case 'asteroidHit': {
                this.radius = random(2, 5);
                this.vel = { x: random(-4, 4), y: random(-4, 4) };
                this.life = 1;
                const cols = ['#ff4500', '#ff6347', '#ff7f50', '#ff8c00', '#ffa500', '#ff6b35'];
                this.color = cols[(Math.random() * cols.length) | 0];
                break;
            }
            case 'asteroidDestroy': {
                this.radius = random(3, 8);
                this.vel = { x: random(-6, 6), y: random(-6, 6) };
                this.life = 1.2;
                const cols = ['#ff4500', '#ff6347', '#ff7f50', '#ff8c00', '#ffa500', '#ff6b35'];
                this.color = cols[(Math.random() * cols.length) | 0];
                break;
            }
            case 'debris': {
                this.radius = random(1, 4);
                this.vel = { x: random(-5, 5), y: random(-5, 5) };
                this.life = 1.5;
                const cols = ['#8b4513', '#a0522d', '#cd853f', '#d2691e', '#b8860b', '#daa520'];
                this.color = cols[(Math.random() * cols.length) | 0];
                break;
            }
            case 'rockDebris': {
                this.radius = random(1, 3);
                const gray = (random(80, 200)) | 0;
                this.color = `rgb(${gray},${gray},${gray})`;
                const [vx, vy] = args;
                this.vel = { x: vx ?? random(-4, 4), y: vy ?? random(-4, 4) };
                this.life = 1.2 + random(0, 0.5);
                this.friction = 0.88 + random(0, 0.07);
                break;
            }
            case 'playerExplosion': {
                this.life = 1;
                this.radius = 0;
                this.maxRadius = 150;
                this.color = '#0ff';
                break;
            }
            case 'thrust': {
                const [angle] = args;
                const cols = ['#ff4500', '#ff8c00', '#ffa500'];
                this.color = cols[(Math.random() * cols.length) | 0];
                const a = angle + random(-0.26, 0.26);
                const s = random(1.5, 3);
                this.radius = random(1, 2.5);
                this.vel = { x: Math.cos(a) * s, y: Math.sin(a) * s };
                this.life = 1;
                break;
            }
            case 'phantom': {
                const [color, radius] = args;
                this.color = color;
                this.radius = radius * 0.8;
                this.life = 0.5;
                this.vel = { x: 0, y: 0 };
                break;
            }
            case 'pickupPulse': {
                this.life = 1;
                this.radius = 0;
                this.maxRadius = 30;
                this.color = 'white';
                break;
            }
        }
    }

    update(pool) {
        if (!this.active) return;
        switch (this.type) {
            case 'explosion':
            case 'thrust':
            case 'asteroidHit':
            case 'asteroidDestroy':
            case 'debris':
                this.x += this.vel.x;
                this.y += this.vel.y;
                this.life -= 0.02;
                break;
            case 'rockDebris':
                this.x += this.vel.x;
                this.y += this.vel.y;
                this.vel.x *= this.friction;
                this.vel.y *= this.friction;
                this.life -= 0.018;
                break;
            case 'phantom':
                this.life -= 0.05;
                break;
            case 'playerExplosion':
                this.life -= 0.02;
                this.radius = (1 - this.life ** 2) * this.maxRadius;
                break;
            case 'pickupPulse':
                this.life -= 0.04;
                this.radius = (1 - this.life) * this.maxRadius;
                break;
        }
        if (this.life <= 0) pool.release(this);
    }

    draw(ctx) {
        if (!this.active) return;
        ctx.save();
        ctx.globalAlpha = Math.max(0, this.life);
        switch (this.type) {
            case 'explosion':
            case 'thrust':
            case 'phantom':
            case 'asteroidHit':
            case 'asteroidDestroy':
            case 'debris':
            case 'rockDebris':
                ctx.fillStyle = this.color;
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.radius, 0, 2 * Math.PI);
                ctx.fill();
                break;
            case 'playerExplosion':
            case 'pickupPulse':
                ctx.strokeStyle = this.color;
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.radius, 0, 2 * Math.PI);
                ctx.stroke();
                break;
        }
        ctx.restore();
    }
}
