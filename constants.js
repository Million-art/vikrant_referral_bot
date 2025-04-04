const BOT_URL = process.env.BOT_URL;
const CHAT_ID = process.env.CHANNEL_ID;
const ADMIN = process.env.ADMIN_ID || "386095768"
const CHANNEL_ID = process.env.CHANNEL_ID || '-1001190544004'
const CHANNEL_URL = process.env.CHANNEL_URL;
const CARD_IMAGE_URL = process.env.CARD_IMAGE_URL
const MIN_REFERRAL_COUNT = process.env.MIN_REFERRAL_COUNT || 0;

// Caption text with default value
const REFERRAL_CAPTION =  `
    Jeetoo Rs 100,000 Har Mahine Vikrant Exchange par!

    Yeh message apne doston ke saath share karo aur har referral par RS 20 bonus pao! Aur jo top 3 users sabse zyada referrals karenge, unhe milega RS 100,000 har mahine Vikrant Exchange par!

    Sabse pehle neeche diye gaye link par click karo: 

    Phir Start par click karo.

    Join Channel par click karo.

    Phir BOT par wapas jao.

    Share ⤴️ symbol ka use karke apne doston aur family ke saath share karo.

    Jitna zyada aap share karenge, utna hi zyada aapke chances badhenge leaderboard par aane ke aur jeetne ke liye RS 100,000 har mahine top 3 referrers ko!

    Abhi share karna shuru karo aur jeetne ke apne chances badhao!
`;

module.exports = {
    BOT_URL,
    ADMIN,
    CHAT_ID,
    CHANNEL_ID,
    CHANNEL_URL,
    CARD_IMAGE_URL,
    MIN_REFERRAL_COUNT,
    REFERRAL_CAPTION
};
  