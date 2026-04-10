class LineChart {
    constructor(canvasId, options = {}) {
        this.canvasId = canvasId;
        this.canvas = null;
        this.ctx = null;
        this.history = [];
        this.maxPoints = options.maxPoints || 100;
        
        // Configuration
        this.fixedMin = options.fixedMin !== undefined ? options.fixedMin : null;
        this.fixedMax = options.fixedMax !== undefined ? options.fixedMax : null;
        this.autoScale = options.autoScale !== undefined ? options.autoScale : false;
        
        // Colors
        this.color = options.color || '#00bfff';
        this.fillColorStart = options.fillColorStart || 'rgba(0, 191, 255, 0.4)';
        this.fillColorEnd = options.fillColorEnd || 'rgba(0, 191, 255, 0.0)';
        
        this.width = 180;
        this.height = 80;
    }

    init() {
        this.canvas = document.getElementById(this.canvasId);
        if (this.canvas) {
            this.ctx = this.canvas.getContext('2d');
            this.width = this.canvas.width;
            this.height = this.canvas.height;
            for (let i = 0; i < this.maxPoints; i++) {
                this.history.push(0);
            }
        }
    }

    update(value) {
        if (!this.ctx) return;
        this.history.push(value);
        if (this.history.length > this.maxPoints) {
            this.history.shift();
        }
        this.draw();
    }

    draw() {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;

        ctx.clearRect(0, 0, w, h);

        let minVal = this.fixedMin !== null ? this.fixedMin : Math.min(...this.history);
        let maxVal = this.fixedMax !== null ? this.fixedMax : Math.max(...this.history);
        
        if (this.autoScale) {
            const padding = (maxVal - minVal) * 0.1;
            if (padding === 0) {
                maxVal += 1;
                minVal -= 1;
            } else {
                maxVal += padding;
                minVal -= padding;
            }
            if (this.fixedMin !== null) minVal = this.fixedMin;
            if (this.fixedMax !== null) maxVal = this.fixedMax;
        }

        const range = maxVal - minVal;
        const getY = (val) => {
            if (range === 0) return h / 2;
            return h - ((val - minVal) / range) * h;
        };

        // Draw grid lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        
        let midVal = (maxVal + minVal) / 2;
        let yMid = getY(midVal);
        ctx.moveTo(0, yMid);
        ctx.lineTo(w, yMid);
        ctx.stroke();
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.font = '8px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(maxVal.toFixed(1), 2, 8);
        ctx.fillText(minVal.toFixed(1), 2, h - 2);
        ctx.fillText(midVal.toFixed(1), 2, yMid - 2);

        // Draw path
        ctx.beginPath();
        for (let i = 0; i < this.history.length; i++) {
            const val = this.history[i];
            const x = (i / (this.maxPoints - 1)) * w;
            const y = getY(val);
            
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }

        ctx.strokeStyle = this.color;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.lineTo(w, h);
        ctx.lineTo(0, h);
        ctx.closePath();

        const gradient = ctx.createLinearGradient(0, 0, 0, h);
        gradient.addColorStop(0, this.fillColorStart);
        gradient.addColorStop(1, this.fillColorEnd);
        ctx.fillStyle = gradient;
        ctx.fill();

        const currentVal = this.history[this.history.length - 1];
        ctx.fillStyle = '#fff';
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(currentVal.toFixed(2), w - 4, 12);
    }
}

export const Telemetry = {
    speedChart: new LineChart('speed-chart-canvas', { 
        fixedMin: 0, fixedMax: 15, autoScale: false 
    }),
    xChart: new LineChart('x-chart-canvas', { 
        autoScale: true, color: '#ff4c4c', fillColorStart: 'rgba(255, 76, 76, 0.4)', fillColorEnd: 'rgba(255, 76, 76, 0.0)' 
    }),
    yChart: new LineChart('y-chart-canvas', { 
        autoScale: true, fixedMin: 0, color: '#4cff4c', fillColorStart: 'rgba(76, 255, 76, 0.4)', fillColorEnd: 'rgba(76, 255, 76, 0.0)' 
    }),
    zChart: new LineChart('z-chart-canvas', { 
        autoScale: true, color: '#4c4cff', fillColorStart: 'rgba(76, 76, 255, 0.4)', fillColorEnd: 'rgba(76, 76, 255, 0.0)' 
    }),

    init() {
        this.speedChart.init();
        this.xChart.init();
        this.yChart.init();
        this.zChart.init();
    },

    update(speed, x, y, z) {
        this.speedChart.update(speed);
        this.xChart.update(x);
        this.yChart.update(y);
        this.zChart.update(z);
    }
};
