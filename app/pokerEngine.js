// ==========================================
// Poker Engine Logic
// ==========================================

class PokerEngine {
    constructor() {
        this.deck = [];
        this.board = [];
        this.pot = 0;
        this.currentBet = 0;
        this.state = 'WAITING'; // WAITING, PREFLOP, FLOP, TURN, RIVER, SHOWDOWN
        this.seats = new Array(6).fill(null);
        this.dealerIndex = 0;
        this.turnIndex = 0;
        this.playersInHand = 0;
    }

    createDeck() {
        const suits = ['♠', '♥', '♦', '♣'];
        const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
        this.deck = [];
        for (let suit of suits) {
            for (let value of values) {
                this.deck.push({ suit, value });
            }
        }
    }

    shuffle() {
        for (let i = this.deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
        }
    }

    dealPlayerCards() {
        for (let seat of this.seats) {
            if (seat && seat.inHand) {
                seat.cards = [this.deck.pop(), this.deck.pop()];
            }
        }
    }

    startHand() {
        this.createDeck();
        this.shuffle();
        this.board = [];
        this.pot = 0;
        this.currentBet = 0;
        
        let activePlayers = 0;
        this.seats.forEach(seat => {
            if (seat && seat.stack > 0) {
                seat.inHand = true;
                seat.currentBet = 0;
                seat.lastAction = '';
                seat.cards = [];
                activePlayers++;
            } else if (seat) {
                seat.inHand = false;
            }
        });

        if (activePlayers < 2) {
            this.state = 'WAITING';
            return false;
        }

        this.playersInHand = activePlayers;
        this.state = 'PREFLOP';
        this.dealPlayerCards();
        
        // Move dealer button
        do {
            this.dealerIndex = (this.dealerIndex + 1) % 6;
        } while (!this.seats[this.dealerIndex] || !this.seats[this.dealerIndex].inHand);

        // Blinds
        let sbIndex = this.getNextActiveIndex(this.dealerIndex);
        let bbIndex = this.getNextActiveIndex(sbIndex);
        this.turnIndex = this.getNextActiveIndex(bbIndex);

        this.postBlind(sbIndex, Config.smallBlind);
        this.postBlind(bbIndex, Config.bigBlind);
        
        this.currentBet = Config.bigBlind;
        return true;
    }

    postBlind(index, amount) {
        let seat = this.seats[index];
        let actual = Math.min(amount, seat.stack);
        seat.stack -= actual;
        seat.currentBet += actual;
        this.pot += actual;
    }

    getNextActiveIndex(currentIndex) {
        let i = (currentIndex + 1) % 6;
        while (i !== currentIndex) {
            if (this.seats[i] && this.seats[i].inHand) return i;
            i = (i + 1) % 6;
        }
        return currentIndex;
    }

    processAction(index, action, amount = 0) {
        if (index !== this.turnIndex || this.state === 'WAITING' || this.state === 'SHOWDOWN') return false;
        
        let seat = this.seats[index];

        if (action === 'fold') {
            seat.inHand = false;
            seat.lastAction = 'Fold';
            this.playersInHand--;
        } else if (action === 'call') {
            let toCall = this.currentBet - seat.currentBet;
            let actual = Math.min(toCall, seat.stack);
            seat.stack -= actual;
            seat.currentBet += actual;
            this.pot += actual;
            seat.lastAction = 'Call';
            if (seat.stack === 0) seat.lastAction = 'All-in';
        } else if (action === 'raise') {
            let totalBet = this.currentBet + amount;
            let toAdd = totalBet - seat.currentBet;
            let actual = Math.min(toAdd, seat.stack);
            seat.stack -= actual;
            seat.currentBet += actual;
            this.pot += actual;
            this.currentBet = seat.currentBet; 
            seat.lastAction = 'Raise';
            if (seat.stack === 0) seat.lastAction = 'All-in';
            
            // Re-open betting for others
            this.seats.forEach(s => { if (s && s !== seat && s.inHand) s.actedThisRound = false; });
        } else if (action === 'check') {
            seat.lastAction = 'Check';
        }

        seat.actedThisRound = true;

        if (this.checkRoundOver()) {
            this.advanceState();
        } else {
            this.turnIndex = this.getNextActiveIndex(this.turnIndex);
        }
        return true;
    }

    checkRoundOver() {
        if (this.playersInHand <= 1) return true;
        for (let seat of this.seats) {
            if (seat && seat.inHand && seat.stack > 0) {
                if (!seat.actedThisRound || seat.currentBet < this.currentBet) {
                    return false;
                }
            }
        }
        return true;
    }

    advanceState() {
        this.seats.forEach(s => {
            if (s) {
                s.currentBet = 0;
                s.actedThisRound = false;
                if (s.lastAction !== 'Fold' && s.lastAction !== 'All-in') {
                    s.lastAction = '';
                }
            }
        });
        this.currentBet = 0;

        if (this.playersInHand <= 1) {
            this.state = 'SHOWDOWN';
            return;
        }

        if (this.state === 'PREFLOP') {
            this.state = 'FLOP';
            this.board.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
            this.turnIndex = this.getNextActiveIndex(this.dealerIndex);
        } else if (this.state === 'FLOP') {
            this.state = 'TURN';
            this.board.push(this.deck.pop());
            this.turnIndex = this.getNextActiveIndex(this.dealerIndex);
        } else if (this.state === 'TURN') {
            this.state = 'RIVER';
            this.board.push(this.deck.pop());
            this.turnIndex = this.getNextActiveIndex(this.dealerIndex);
        } else if (this.state === 'RIVER') {
            this.state = 'SHOWDOWN';
        }
    }
}
