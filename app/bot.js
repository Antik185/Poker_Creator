// ==========================================
// Simple Bot Logic
// ==========================================

class Bot {
    constructor(engine, mainHook) {
        this.engine = engine;
        this.mainHook = mainHook;
    }

    takeTurn() {
        if (this.engine.state === 'WAITING' || this.engine.state === 'SHOWDOWN') return;

        let index = this.engine.turnIndex;
        let seat = this.engine.seats[index];

        if (seat && seat.isBot && seat.inHand) {
            // Simple logic: Call if there's a bet, Check otherwise
            setTimeout(() => {
                let toCall = this.engine.currentBet - seat.currentBet;
                if (toCall > 0) {
                    this.mainHook.uiAction('call', index);
                } else {
                    this.mainHook.uiAction('check', index);
                }
            }, 1000 + Math.random() * 1000); // 1-2 second delay
        }
    }
}
