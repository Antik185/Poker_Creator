// ==========================================
// Main UI Controller
// ==========================================

const engine = new PokerEngine();
const bot = new Bot(engine, { uiAction: (action, seatIndex) => Main.uiAction(action, seatIndex) });

const Main = {
    userSeatIndex: -1,

    init() {
        console.log("Poker Room Initializing...");
        
        // Apply styling variables from config
        const root = document.documentElement;
        root.style.setProperty('--c1', Config.theme.felt.c1);
        root.style.setProperty('--c2', Config.theme.felt.c2);
        root.style.setProperty('--c3', Config.theme.felt.c3);
        root.style.setProperty('--c4', Config.theme.felt.c4);

        document.getElementById('bigFeltSurface').style.background = 
            `radial-gradient(ellipse 70% 55% at 50% 40%, var(--c1) 0%, var(--c2) 35%, var(--c3) 65%, var(--c4) 100%)`;

        document.getElementById('slLetter').textContent = Config.brandLetter;
        document.getElementById('slName').textContent = Config.brandName;

        document.getElementById('screenLogo').style.top = Config.theme.logoPosTop;
        document.getElementById('screenLogo').style.left = Config.theme.logoPosLeft;
        document.getElementById('slImg').style.width = Config.theme.logoSize;
        document.getElementById('slImg').style.height = Config.theme.logoSize;
        document.getElementById('slImg').style.fontSize = `calc(${Config.theme.logoSize} * 0.55)`;

        document.getElementById('blindsText').textContent = `$${Config.smallBlind.toFixed(2)} / $${Config.bigBlind.toFixed(2)}`;
        
        this.renderSeats();
    },

    renderSeats() {
        const container = document.getElementById('seatsContainer');
        container.innerHTML = '';
        
        // Positioning angles for 6 seats
        const positions = [
            { top: 'calc(100% + 14px)', left: '50%', transform: 'translateX(-50%)' }, // Base (User)
            { top: '50%', left: 'calc(100% + 12px)', transform: 'translateY(-50%)' }, // Right
            { bottom: 'calc(100% - 52px)', right: '60px', transform: '' },            // Top Right
            { bottom: 'calc(100% + 14px)', left: '50%', transform: 'translateX(-50%)' }, // Top Center
            { bottom: 'calc(100% - 52px)', left: '60px', transform: '' },             // Top Left
            { top: '50%', right: 'calc(100% + 12px)', transform: 'translateY(-50%)' }, // Left
        ];

        for (let i = 0; i < 6; i++) {
            let seatData = engine.seats[i];
            
            // Allow user to sit anywhere, but visually we lock them to Bottom Center (idx 0) 
            // by rotating the "view" if needed. For simplicity in the demo, the user simply clicks "Sit"
            // and gets assigned the empty seat.
            
            let html = '';
            let style = `top:${positions[i].top}; left:${positions[i].left || 'auto'}; right:${positions[i].right || 'auto'}; bottom:${positions[i].bottom || 'auto'}; transform:${positions[i].transform};`;

            if (seatData) {
                let badgeHtml = '';
                if (seatData.lastAction) {
                    let badgeClass = '';
                    switch (seatData.lastAction) {
                        case 'Raise': badgeClass = 'raise'; break;
                        case 'Call': badgeClass = 'call'; break;
                        case 'Fold': badgeClass = 'fold'; break;
                        case 'Check': badgeClass = 'check'; break;
                        case 'All-in': badgeClass = 'raise'; break;
                    }
                    badgeHtml = `<div class="pk-badge ${badgeClass}">${seatData.lastAction.toUpperCase()} ${seatData.currentBet > 0 ? '$'+seatData.currentBet.toFixed(2) : ''}</div>`;
                }

                let cardsHtml = '';
                if (seatData.inHand) {
                    if (seatData.isUser || (engine.state === 'SHOWDOWN' && seatData.cards.length === 2)) {
                        // Show cards
                        cardsHtml = `<div class="pk-cards">
                            <div class="pk-card face ${seatData.cards[0].suit==='♥'||seatData.cards[0].suit==='♦'?'pk-card-r':'pk-card-b'}"><div class="pk-cv">${seatData.cards[0].value}</div><div class="pk-cs">${seatData.cards[0].suit}</div></div>
                            <div class="pk-card face ${seatData.cards[1].suit==='♥'||seatData.cards[1].suit==='♦'?'pk-card-r':'pk-card-b'}"><div class="pk-cv">${seatData.cards[1].value}</div><div class="pk-cs">${seatData.cards[1].suit}</div></div>
                        </div>`;
                    } else {
                        // Face down cards
                        cardsHtml = `<div class="pk-cards"><div class="pk-card back"></div><div class="pk-card back"></div></div>`;
                    }
                }

                let dealerBtn = engine.dealerIndex === i ? `<div class="pk-dealer">D</div>` : '';
                let activeClass = engine.turnIndex === i && engine.state !== 'WAITING' ? 'active' : '';
                let youClass = seatData.isUser ? 'you-seat' : '';
                let avaClass = seatData.isUser ? 'you' : '';

                html = `
                <div class="pk-seat ${youClass}" style="${style}">
                    ${cardsHtml}
                    <div class="pk-body">
                        <div class="pk-ava ${activeClass} ${avaClass}" style="background-image: url('${Config.avatars[seatData.avatarIndex]}'); background-size: cover; background-position: center;"></div>
                        <div class="pk-lvl">50</div>
                        <div class="pk-flag">${seatData.country}</div>
                        ${dealerBtn}
                    </div>
                    <div class="pk-plate ${activeClass} ${avaClass}">
                        <div class="pk-name">${seatData.name}</div>
                        <div class="pk-chips">$${seatData.stack.toFixed(2)}</div>
                    </div>
                    ${badgeHtml}
                </div>`;
            } else {
                html = `
                <div class="pk-seat empty-seat" style="${style}">
                    <div class="pk-body" style="cursor: pointer; opacity: 0.5;" onclick="Main.sitDownAt(${i})">
                        <div class="pk-ava"><div class="pk-init" style="font-size: 24px;">SIT</div></div>
                    </div>
                </div>`;
            }
            container.innerHTML += html;
        }
    },

    renderBoard() {
        const boardContainer = document.getElementById('communityCardsContainer');
        boardContainer.innerHTML = '';
        engine.board.forEach((card, idx) => {
            let colorClass = card.suit === '♥' || card.suit === '♦' ? 'bc-r' : 'bc-b';
            boardContainer.innerHTML += `
            <div class="bcard lg face ${colorClass} deal-anim" style="animation-delay:.0${idx*7}s">
                <div class="bc-corner"><span>${card.value}</span><span>${card.suit}</span></div>
                <div class="bcv">${card.value}</div><div class="bcs">${card.suit}</div>
            </div>`;
        });

        // Pot
        const potContainer = document.getElementById('potContainer');
        if (engine.pot > 0) {
            potContainer.style.display = 'flex';
            document.getElementById('potText').textContent = `Total Pot: $${engine.pot.toFixed(2)}`;
            let potChips = document.getElementById('potChips');
            potChips.innerHTML = `
                <div style="display:flex;flex-direction:column;gap:0;margin-right:3px;">
                  <div class="pchip" style="background:#4b9fe8;height:5px;border-radius:2px;width:16px;"></div>
                  <div class="pchip" style="background:#3a8ed0;height:5px;border-radius:2px;width:16px;margin-top:-1px;"></div>
                </div>`;
        } else {
            potContainer.style.display = 'none';
        }
    },

    updateUI() {
        this.renderSeats();
        this.renderBoard();

        const actionMenu = document.getElementById('actionMenu');
        const userMenu = document.getElementById('userActions');
        const sitMenu = document.getElementById('sitMenu');

        if (this.userSeatIndex === -1) {
            actionMenu.style.display = 'flex';
            userMenu.style.display = 'none';
            sitMenu.style.display = 'flex';
        } else {
            sitMenu.style.display = 'none';
            if (engine.turnIndex === this.userSeatIndex && engine.state !== 'WAITING' && engine.state !== 'SHOWDOWN') {
                actionMenu.style.display = 'flex';
                userMenu.style.display = 'flex';

                let userSeat = engine.seats[this.userSeatIndex];
                let toCall = engine.currentBet - userSeat.currentBet;
                
                let btnCheckCall = document.getElementById('btnCheckCall');
                if (toCall > 0) {
                    btnCheckCall.textContent = `Call $${toCall.toFixed(2)}`;
                } else {
                    btnCheckCall.textContent = `Check`;
                }

                // Slider calc
                let minRaise = toCall + Config.bigBlind;
                let slider = document.getElementById('betSlider');
                slider.min = minRaise * 100;
                slider.max = userSeat.stack * 100;
                this.uiUpdateSlider(slider.value); // Sync label

            } else {
                actionMenu.style.display = 'none';
                userMenu.style.display = 'none';
            }
        }
    },

    uiUpdateSlider(valInCents) {
        let val = valInCents / 100;
        document.getElementById('betVal').textContent = `$${val.toFixed(2)}`;
        document.getElementById('raiseLbl').textContent = `$${val.toFixed(2)}`;
    },

    uiSetBetPres(multiplier) {
        let pot = engine.pot;
        let amount = Math.max(Config.bigBlind, pot * multiplier);
        let slider = document.getElementById('betSlider');
        slider.value = amount * 100;
        this.uiUpdateSlider(slider.value);
    },

    sitDownAt(index) {
        if (this.userSeatIndex !== -1) return; // Already seated
        if (engine.seats[index]) return; // Occupied

        engine.seats[index] = {
            id: 'User',
            name: 'Pikachu (You)',
            country: '🌍',
            avatarIndex: 4, 
            stack: Config.startingStack,
            isBot: false,
            isUser: true,
            inHand: false,
            currentBet: 0,
            lastAction: ''
        };
        this.userSeatIndex = index;

        // Auto add bots to remaining empty seats until max
        let botsAdded = 0;
        for (let i = 0; i < 6; i++) {
            if (!engine.seats[i] && botsAdded < Config.players.length) {
                engine.seats[i] = { ...Config.players[botsAdded], inHand: false, currentBet: 0, lastAction: '' };
                botsAdded++;
            }
        }

        this.updateUI();
        setTimeout(() => this.startGame(), 2000); // 2 second delay before starting
    },

    sitDown() {
        // Find first empty seat
        for (let i = 0; i < 6; i++) {
            if (!engine.seats[i]) {
                this.sitDownAt(i);
                return;
            }
        }
    },

    startGame() {
        document.getElementById('messageCenter').style.display = 'none';
        if(engine.startHand()) {
            this.gameLoop();
        }
    },

    gameLoop() {
        this.updateUI();
        
        if (engine.state === 'SHOWDOWN') {
            this.handleShowdown();
            return;
        }

        let currSeat = engine.seats[engine.turnIndex];
        if (currSeat && currSeat.isBot) {
            bot.takeTurn();
        }
    },

    uiAction(action, index = this.userSeatIndex) {
        let slider = document.getElementById('betSlider');
        let amount = action === 'raise' ? slider.value / 100 : 0;
        
        let valid = engine.processAction(index, action, amount);
        if (valid) {
            this.updateUI();
            
            // Artificial delay before moving to next action or next street for realism
            setTimeout(() => {
                this.gameLoop();
            }, 500);
        }
    },

    handleShowdown() {
        document.getElementById('messageCenter').textContent = "SHOWDOWN";
        document.getElementById('messageCenter').style.display = 'block';

        // Simply distribute pot to an active player (mocked)
        setTimeout(() => {
            let activePlayers = engine.seats.filter(s => s && s.inHand);
            if(activePlayers.length > 0) {
                let winner = activePlayers[Math.floor(Math.random() * activePlayers.length)];
                winner.stack += engine.pot;
                document.getElementById('messageCenter').textContent = `${winner.name.toUpperCase()} WINS $${engine.pot.toFixed(2)}`;
            }
            engine.pot = 0;
            this.updateUI();

            setTimeout(() => {
                this.startGame();
            }, 3000);
        }, 1500);
    }
};

window.onload = () => Main.init();
