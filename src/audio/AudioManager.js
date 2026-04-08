export class AudioManager {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        this.noiseBuffer = null;
        this.enabled = true;
        this.volume = 0.42;
    }

    ensureContext() {
        if (this.ctx) return this.ctx;
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return null;

        this.ctx = new AudioContextClass();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this.volume;
        this.masterGain.connect(this.ctx.destination);
        this.noiseBuffer = this.createNoiseBuffer();
        return this.ctx;
    }

    async unlock() {
        const ctx = this.ensureContext();
        if (!ctx) return;
        if (ctx.state !== 'running') {
            try { await ctx.resume(); } catch {}
        }
    }

    setEnabled(enabled) { this.enabled = enabled; }
    setVolume(volume) {
        this.volume = volume;
        if (this.masterGain) this.masterGain.gain.value = volume;
    }

    createNoiseBuffer() {
        const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 2.0, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) { data[i] = Math.random() * 2 - 1; }
        return buffer;
    }

    // --- 核心声音发生器 ---
    createOsc(type, startFreq, endFreq, startTime, duration) {
        const osc = this.ctx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(startFreq, startTime);
        if (startFreq !== endFreq) {
            osc.frequency.exponentialRampToValueAtTime(Math.max(0.001, endFreq), startTime + duration);
        }
        return osc;
    }

    createEnv(startTime, attack, decay, peakVolume) {
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.exponentialRampToValueAtTime(peakVolume, startTime + attack);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + attack + decay);
        gain.connect(this.masterGain);
        return gain;
    }

    // --- 1. 标枪发射 (锐利切割空气) ---
    playShoot(isSpecial = false) {
        const ctx = this.ensureContext();
        if (!ctx || ctx.state !== 'running' || !this.enabled) return;
        const t = ctx.currentTime;
        
        const attack = 0.01;
        const decay = isSpecial ? 0.25 : 0.15;
        const peak = isSpecial ? 0.3 : 0.2;
        
        const osc1 = this.createOsc(isSpecial ? 'sawtooth' : 'triangle', isSpecial ? 900 : 1200, 150, t, attack + decay);
        const gain1 = this.createEnv(t, attack, decay, peak);
        osc1.connect(gain1);
        osc1.start(t); osc1.stop(t + attack + decay + 0.1);

        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(isSpecial ? 3500 : 4500, t);
        filter.frequency.exponentialRampToValueAtTime(800, t + decay);
        filter.Q.value = 1.2;
        
        const noiseGain = this.createEnv(t, 0.01, decay * 0.8, peak * 0.6);
        noise.connect(filter).connect(noiseGain);
        noise.start(t); noise.stop(t + attack + decay + 0.1);
    }

    // --- 2. 标枪停驻/入地 (铿锵金属) ---
    playDeploy(isSpecial = false) {
        const ctx = this.ensureContext();
        if (!ctx || ctx.state !== 'running' || !this.enabled) return;
        const t = ctx.currentTime;
        const attack = 0.005, decay = 0.12, peak = isSpecial ? 0.25 : 0.15;

        const osc = this.createOsc('square', isSpecial ? 1600 : 2000, 200, t, decay);
        const gain = this.createEnv(t, attack, decay, peak);
        osc.connect(gain);
        osc.start(t); osc.stop(t + attack + decay + 0.1);

        const sub = this.createOsc('sine', isSpecial ? 120 : 150, 40, t, decay * 1.5);
        const subGain = this.createEnv(t, attack, decay * 1.5, peak * 1.5);
        sub.connect(subGain);
        sub.start(t); sub.stop(t + attack + decay * 1.5 + 0.1);
    }

    // --- 3. 开始回收 (能量共鸣) ---
    playRecallStart() {
        const ctx = this.ensureContext();
        if (!ctx || ctx.state !== 'running' || !this.enabled) return;
        const t = ctx.currentTime;
        
        const osc = this.createOsc('sine', 150, 450, t, 0.2);
        const gain = this.createEnv(t, 0.1, 0.15, 0.15);
        osc.connect(gain);
        osc.start(t); osc.stop(t + 0.3);
    }

    // --- 4. 回收完成 (清脆入鞘) ---
    playRecallComplete() {
        const ctx = this.ensureContext();
        if (!ctx || ctx.state !== 'running' || !this.enabled) return;
        const t = ctx.currentTime;
        
        const osc = this.createOsc('triangle', 1200, 800, t, 0.05);
        const gain = this.createEnv(t, 0.002, 0.05, 0.15);
        osc.connect(gain);
        osc.start(t); osc.stop(t + 0.06);
    }

    // --- 5. 命中/切割 (肉体+装甲受击) ---
    playHit(kind = 'high') {
        const ctx = this.ensureContext();
        if (!ctx || ctx.state !== 'running' || !this.enabled) return;
        const t = ctx.currentTime;

        if (kind === 'low') {
            const osc = this.createOsc('triangle', 800, 200, t, 0.08);
            const gain = this.createEnv(t, 0.005, 0.06, 0.15);
            osc.connect(gain);
            osc.start(t); osc.stop(t + 0.1);
            return;
        }

        const attack = 0.01;
        let decay = kind === 'special' ? 0.35 : 0.15;
        let peak = kind === 'special' ? 0.45 : 0.25;

        const sub = this.createOsc('sine', kind === 'special' ? 180 : 250, 40, t, decay);
        const subGain = this.createEnv(t, attack, decay, peak * 1.5);
        sub.connect(subGain);
        sub.start(t); sub.stop(t + decay + 0.1);

        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(kind === 'special' ? 3000 : 5000, t);
        filter.frequency.exponentialRampToValueAtTime(100, t + decay);
        const noiseGain = this.createEnv(t, attack, decay, peak);
        noise.connect(filter).connect(noiseGain);
        noise.start(t); noise.stop(t + decay + 0.1);

        if (kind === 'special') {
            const saw = this.createOsc('sawtooth', 300, 50, t, decay);
            const sawGain = this.createEnv(t, 0.02, decay * 0.8, 0.2);
            saw.connect(sawGain);
            saw.start(t); saw.stop(t + decay + 0.1);
        }
    }

    // --- 6. 敌人死亡 (沉重爆散) ---
    playEnemyDeath() {
        const ctx = this.ensureContext();
        if (!ctx || ctx.state !== 'running' || !this.enabled) return;
        const t = ctx.currentTime;
        
        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(800, t);
        filter.frequency.linearRampToValueAtTime(100, t + 0.3);
        filter.Q.value = 0.8;
        const noiseGain = this.createEnv(t, 0.02, 0.25, 0.3);
        noise.connect(filter).connect(noiseGain);
        noise.start(t); noise.stop(t + 0.35);

        const sub = this.createOsc('square', 100, 20, t, 0.3);
        const subGain = this.createEnv(t, 0.01, 0.3, 0.25);
        sub.connect(subGain);
        sub.start(t); sub.stop(t + 0.35);
    }

    // --- 7. 中断回收 (高频电流掐断) ---
    playInterrupt() {
        const ctx = this.ensureContext();
        if (!ctx || ctx.state !== 'running' || !this.enabled) return;
        const t = ctx.currentTime;

        const osc = this.createOsc('square', 2000, 100, t, 0.1);
        const gain = this.createEnv(t, 0.005, 0.08, 0.25);
        osc.connect(gain);
        osc.start(t); osc.stop(t + 0.15);

        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 4000;
        const noiseGain = this.createEnv(t, 0.005, 0.05, 0.3);
        noise.connect(filter).connect(noiseGain);
        noise.start(t); noise.stop(t + 0.1);
    }

    // --- 8. 敌人生成预警 (魔法阵低沉嗡鸣) ---
    playTelegraph() {
        const ctx = this.ensureContext();
        if (!ctx || ctx.state !== 'running' || !this.enabled) return;
        const t = ctx.currentTime;
        
        const osc = this.createOsc('sine', 80, 120, t, 3.0);
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 6;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 15;
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        
        const gain = this.createEnv(t, 1.5, 1.5, 0.15);
        osc.connect(gain);
        osc.start(t); lfo.start(t);
        osc.stop(t + 3.1); lfo.stop(t + 3.1);
    }

    // --- 9. 敌人出生 (黑烟涌出) ---
    playSpawn() {
        const ctx = this.ensureContext();
        if (!ctx || ctx.state !== 'running' || !this.enabled) return;
        const t = ctx.currentTime;

        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(400, t);
        filter.frequency.exponentialRampToValueAtTime(2000, t + 0.2);
        
        const gain = this.createEnv(t, 0.05, 0.25, 0.2);
        noise.connect(filter).connect(gain);
        noise.start(t); noise.stop(t + 0.35);
    }

    // --- 10. UI 点击声 ---
    playUIClick() {
        const ctx = this.ensureContext();
        if (!ctx || ctx.state !== 'running' || !this.enabled) return;
        const t = ctx.currentTime;
        
        const osc = this.createOsc('sine', 800, 600, t, 0.03);
        const gain = this.createEnv(t, 0.002, 0.03, 0.1);
        osc.connect(gain);
        osc.start(t); osc.stop(t + 0.05);
    }
}