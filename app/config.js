// ==========================================
// Poker Room Configuration
// ==========================================

const Config = {
    brandName: "POKER GO", // Brand name displayed in logos
    brandLetter: "P",      // Initial letter for the logo badge
    
    // Limits
    smallBlind: 0.05,
    bigBlind: 0.10,
    startingStack: 10.00,
    maxPlayers: 6,

    // Visuals
    theme: {
        // Felt gradient: radial-gradient(ellipse 70% 55% at 50% 40%, c1 0%, c2 35%, c3 65%, c4 100%)
        // Following the Pokerok screenshot, a deep, rich green.
        felt: {
            c1: "#35c955", // Center highlight
            c2: "#28a842", // Mid green
            c3: "#1e8a35", // Dark green
            c4: "#146025"  // Edge shadow
        },
        logoSize: "40px",
        logoPosTop: "20px",
        logoPosLeft: "20px",
        logoPosRight: "auto"
    },

    // Avatars from sample
    avatars: [
        "../avatars/ca542146e6540e535ca26a65dac45d3a.png", // Cat
        "../avatars/8d38a5b8f7b789ee09c0b8bbce7ec57a.png", // Sofia
        "../avatars/f38f10dce6b953ccbd55d6019f0850e7.png", // Einstein
        "../avatars/70fc7b922b62f1dc10a4525742cd6568.png", // Flags
        "../avatars/a76faaf75b6381bf141dd719f325be43.png", // Empty avatar
        "../avatars/fabc06a478a72e2ad7c3e9a37e295d60.png"  // Letter
    ],

    // Player definitions (Simulated players already at the table)
    players: [
        { id: 1, name: "Coffee_Time", country: "🇱🇻", avatarIndex: 0, stack: 14.83, isBot: true },
        { id: 2, name: "DlmaDIDlma", country: "🇷🇺", avatarIndex: 1, stack: 11.17, isBot: true },
        { id: 3, name: "CallDeFarol1", country: "🇦🇷", avatarIndex: 2, stack: 10.00, isBot: true },
        { id: 4, name: "sdszfyzc", country: "🇨🇳", avatarIndex: 3, stack: 5.66, isBot: true },
        { id: 5, name: "faker77777", country: "🇨🇳", avatarIndex: 5, stack: 8.65, isBot: true },
    ]
};
