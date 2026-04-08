export const SpeedChart = {
    canvas: null,
    ctx: null,
    history: [],
    maxPoints: 100,
    fixedMaxSpeed: 15, // 定死最大值为 15 (可以包容普通移动速度的上限)
    width: 180,
    height: 80,

    init() {
        this.canvas = document.getElementById('speed-chart-canvas');
        if (this.canvas) {
            this.ctx = this.canvas.getContext('2d');
            this.width = this.canvas.width;
            this.height = this.canvas.height;
            // Initialize history with 0s
            for (let i = 0; i < this.maxPoints; i++) {
                this.history.push(0);
            }
        }
    },

    update(speed) {
        if (!this.ctx) return;
        
        // Add new speed to history
        this.history.push(speed);
        if (this.history.length > this.maxPoints) {
            this.history.shift();
        }

        // Removed dynamic scaling
        // this.maxObservedSpeed = Math.max(10, ...this.history) * 1.1; 

        this.draw();
    },

    draw() {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;

        // Clear canvas
        ctx.clearRect(0, 0, w, h);

        // Draw grid lines (horizontal) at fixed intervals
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        // line at 5 speed
        let y5 = h - (5 / this.fixedMaxSpeed) * h;
        ctx.moveTo(0, y5);
        ctx.lineTo(w, y5);
        // line at 10 speed
        let y10 = h - (10 / this.fixedMaxSpeed) * h;
        ctx.moveTo(0, y10);
        ctx.lineTo(w, y10);
        ctx.stroke();
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.font = '8px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('10', 2, y10 - 2);
        ctx.fillText('5', 2, y5 - 2);

        // Draw path
        ctx.beginPath();
        for (let i = 0; i < this.history.length; i++) {
            const val = this.history[i];
            const x = (i / (this.maxPoints - 1)) * w;
            const y = h - (Math.min(val, this.fixedMaxSpeed) / this.fixedMaxSpeed) * h;
            
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }

        // Stroke line
        ctx.strokeStyle = '#00bfff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Fill under line
        ctx.lineTo(w, h);
        ctx.lineTo(0, h);
        ctx.closePath();

        const gradient = ctx.createLinearGradient(0, 0, 0, h);
        gradient.addColorStop(0, 'rgba(0, 191, 255, 0.4)');
        gradient.addColorStop(1, 'rgba(0, 191, 255, 0.0)');
        ctx.fillStyle = gradient;
        ctx.fill();

        // Draw current value text
        const currentSpeed = this.history[this.history.length - 1];
        ctx.fillStyle = '#fff';
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(currentSpeed.toFixed(1), w - 4, 12);
    }
};
