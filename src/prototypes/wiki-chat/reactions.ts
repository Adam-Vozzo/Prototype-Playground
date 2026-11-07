/**
 * The chat's vocabulary. Everything here is filler that chatters post in
 * between article sentences. `reaction()` picks a line, sometimes riffing on
 * the sentence that was just read (keywords, years, numbers, topics) or
 * @-mentioning another chatter, and avoids repeating recent lines.
 *
 * Template tokens: {w} keyword, {W} KEYWORD, {y} year, {n} number, {u} username.
 */

const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

// ---------------------------------------------------------------------------
// Generic lines, grouped by vibe. Groups are weighted in GROUPS below.
// ---------------------------------------------------------------------------

const HYPE = [
  'W', 'W chat', 'W article', 'W stream', 'W fact', 'huge W', 'massive W', 'W W W', 'dub',
  'LETS GOOO', 'LETS GO', 'lets gooooo', 'HYPE', 'hype hype hype', 'this is peak', 'peak content',
  'peak fiction', 'peak wikipedia', 'banger', 'absolute banger', 'banger sentence', 'goated',
  'goated article', 'GOAT', 'certified classic', 'cinema', 'pure cinema', 'this is cinema',
  'masterpiece', 'chef’s kiss', '10/10', '11/10', '10/10 no notes', 'no notes', 'elite',
  'elite ball knowledge', 'insane lore', 'the lore is crazy', 'lore drop', 'LORE', 'the lore goes deep',
  'core memory unlocked', 'goosebumps', 'chills', 'i have chills', 'what a time to be alive',
  'history being read live', 'we are so back', 'its so back', 'back and better than ever',
  'clip it', 'CLIP THAT', 'someone clip that', 'clipped', 'clip farming', 'add that to the highlights',
  'this goes hard', 'goes so hard', 'hard', 'hardest sentence of the year', 'top 10 sentences',
  'sentence of the stream', 'that line was crafted', 'whoever wrote that deserves a raise',
  'give the editor a medal', 'editor ate', 'ate', 'ate and left no crumbs', 'slay', 'mother',
  'iconic', 'legendary', 'legend', 'king', 'queen', 'royalty behavior', 'aura', '+1000 aura',
  'infinite aura', 'aura farming', 'main character energy', 'built different', 'different breed',
  'unmatched', 'undefeated', 'unreal', 'surreal', 'fire', '🔥', '🔥🔥🔥', 'this stream is fire',
  'W streamer', 'streamer reading like a pro', 'reading arc', 'the reading arc goes crazy',
  'gaming', 'we gaming', 'gamers rise up (to read)', 'GG', 'gg go next',
  'unbelievable scenes', 'scenes', 'SCENES', 'the crowd goes wild',
];

const DISBELIEF = [
  'no way', 'NO WAY', 'no shot', 'no shot bro', 'nah', 'nahhh', 'nah no way', 'ain’t no way',
  'aint no way bro', 'stop', 'STOP', 'stop it', 'stop lying', 'you’re lying', 'liar', 'cap', 'thats cap',
  'big cap', 'cap 🧢', '🧢', 'bro is capping', 'wikipedia is capping', 'source: trust me bro',
  'citation needed', '[citation needed]', 'source?', 'sauce?', 'source??', 'proof?', 'pics or it didn’t happen',
  'i refuse to believe this', 'i do not believe this', 'actually?', 'actually??', 'for real?', 'fr?',
  'fr fr?', 'deadass?', 'seriously?', 'be serious', 'you can’t be serious', 'what', 'WHAT', 'WHAT???',
  'wait what', 'wait WHAT', 'hold on', 'hold up', 'hold on hold on', 'wait wait wait', 'excuse me?',
  'pardon?', 'run that back', 'RUN IT BACK', 'say that again', 'repeat that', 'read that again',
  'one more time', 'huh', 'HUH', 'huhhh', 'what did i just read', 'what did i just hear',
  'did i read that right', 'am i reading this right', 'chat is this real', 'chat is this true',
  'chat is he serious', 'is this real life', 'this can’t be real', 'fake news', 'this is fake',
  'photoshopped', 'AI generated', 'scripted', 'this is staged', 'no f-ing way', 'i’m shaking',
  'my jaw dropped', 'jaw on the floor', '😳', '😳😳😳', '😱', '🤯', '🤯🤯', 'mind blown', 'mind = blown',
  'brain exploded', 'i need a minute', 'give me a second', 'processing...', 'loading...', 'buffering',
  'that’s insane', 'actually insane', 'genuinely insane', 'insane', 'INSANE', 'crazy', 'kinda crazy ngl',
  'crazy work', 'wild', 'that’s wild', 'unhinged', 'lowkey unhinged', 'deranged', 'diabolical',
  'criminal', 'illegal', 'this should be illegal', 'how is that legal', 'sus', 'kinda sus', 'mega sus',
];

const LAUGH = [
  'LMAO', 'LMAOOO', 'lmao', 'lmaooo', 'LOL', 'lol', 'lolol', 'kek', 'ROFL', 'i’m crying',
  'im crying', 'crying', 'CRYING', 'i’m wheezing', 'wheezing', 'i can’t breathe', 'help', 'HELP',
  'help me', 'i’m deceased', 'deceased', 'dead', 'DEAD', 'i’m dead', 'im actually dead', 'rip me',
  '💀', '💀💀', '💀💀💀', '💀💀💀💀💀', '😭', '😭😭', '😭😭😭', '😂', '😂😂😂', '🤣', '🤣🤣', 'bro 💀',
  'nah 💀', 'chat 💀', 'not this 💀', 'the way i laughed', 'that’s so funny', 'too funny',
  'comedy', 'pure comedy', 'comedy gold', 'comedic genius', 'who wrote this, a comedian?',
  'wikipedia editors are comedians', 'this article has jokes', 'i laughed way too hard',
  'spat out my drink', 'my roommate is staring at me', 'laughing at 3am', 'giggling', 'snort',
  'ha', 'haha', 'hahaha', 'HAHAHA', 'heh', 'hehe', 'that one got me', 'got me there',
  'lost it', 'LOST IT', 'i lost it at that', 'i’m on the floor',
];

const CONFUSED = [
  '?', '??', '???', '????', '?????', 'what', 'what?', 'huh?', 'i’m lost', 'lost', 'confused',
  'so confused', 'i’m confused', 'chat i’m confused', 'can someone explain', 'explain pls',
  'eli5', 'ELI5 please', 'explain like i’m 5', 'in english please', 'english??', 'translate',
  'translation?', 'subtitles?', 'what does that mean', 'what does that even mean', 'meaning?',
  'definition?', 'define that', 'i don’t get it', 'i dont get it', 'i don’t understand', 'brain hurts',
  'my brain hurts', 'my two brain cells', 'brain fog', 'brain.exe stopped working', '🤔', '🤔🤔',
  '🧐', 'hmm', 'hmmm', 'hmmmm', 'interesting...', 'curious', 'wait so', 'so wait', 'so basically',
  'wait so basically', 'context?', 'what’s the context', 'what did i miss', 'just got here what happened',
  'can someone recap', 'recap?', 'tldr?', 'tl;dr', 'too long didn’t read', 'summary pls',
  'what are we reading', 'what article is this', 'what’s the topic', 'why are we reading this',
  'how did we get here', 'how is this related', 'is this on the test', 'will this be on the exam',
  'is there a quiz after', 'i need a diagram', 'need a visual', 'graph?', 'map?', 'where is that',
  'when was this', 'who is that', 'who?', 'who??', 'which one', 'how', 'how??', 'why', 'why??',
];

const NERD = [
  '🤓☝️', '🤓', '☝️🤓', 'um actually', 'umm actually 🤓', 'well actually', 'technically',
  'technically correct', 'technically correct, the best kind of correct', 'nerd', 'NERD',
  'nerd alert', 'nerd emoji', 'certified nerd moment', 'nerds rise up', 'scholar', 'scholar arc',
  'academic weapon', 'big brain', 'galaxy brain', 'gigabrain', '🧠', '🧠🧠🧠', 'brain gains',
  'IQ +10', '+5 IQ', 'my IQ just went up', 'getting smarter by the minute', 'i feel smarter',
  'free education', 'free college', 'better than school', 'this stream is my school now',
  'my teacher said never use wikipedia', 'teacher if you see this, i’m studying', 'studying btw',
  'homework speedrun', 'cramming for finals', 'writing my essay with this', 'citing this stream',
  'adding this to my bibliography', 'MLA format?', 'APA citation?', 'peer reviewed?',
  'is this peer reviewed', 'primary source?', 'secondary source tbh', 'needs more citations',
  'this section needs expansion', 'stub energy', 'this article could use more pictures',
  'who edits these', 'shoutout to the editors', 'editors carrying', 'the talk page must be wild',
  'check the talk page', 'the edit history is a battlefield', 'edit war incoming',
  'someone vandalize it (jk)', 'TIL', 'TIL!!', 'today i learned', 'learned something today',
  'didn’t know that', 'never knew', 'i never knew that', 'the more you know', 'the more you know ⭐',
  'fun fact', 'fun fact unlocked', 'trivia night ammo', 'saving this for trivia', 'pub quiz material',
  'useful knowledge', 'useless knowledge (i love it)', 'filing that away', 'noted', 'noted 📝',
  'taking notes', '📝', '📝📝', '📚', '📚📚📚', '📖', 'reading is so back', 'literacy W',
  'reading W', 'literacy speedrun', 'books but faster', 'audiobook mode', 'learn with chat',
  'interesting', 'very interesting', 'fascinating', 'riveting', 'enlightening', 'educational',
  'so educational', 'this is so educational', 'educational content', 'documentary vibes',
  'narrator voice', 'needs a narrator', 'read it in a documentary voice', 'nature doc energy',
];

const AGREE = [
  'real', 'REAL', 'so real', 'too real', 'real and true', 'true', 'TRUE', 'facts', 'FACTS',
  'fax', 'straight facts', 'no cap', 'no cap fr', 'fr', 'frfr', 'fr fr', 'on god', 'ong',
  'deadass', 'literally', 'literally me', 'that’s me', 'me fr', 'relatable', 'so relatable',
  'big mood', 'mood', 'same', 'same tbh', 'same here', 'me too', 'me when', 'this is so me',
  '+1', '+2', 'agreed', 'agree', 'yes', 'yep', 'yup', 'yeah', 'ye', 'correct', 'accurate',
  'very accurate', 'spot on', 'nailed it', 'exactly', 'EXACTLY', 'precisely', 'this', 'THIS',
  '^', '^^^', 'this ^', 'what they said', 'based', 'BASED', 'so based', 'based and real',
  'based article', 'valid', 'so valid', 'understandable', 'fair', 'fair enough', 'reasonable',
  'makes sense', 'that tracks', 'checks out', 'tracks', 'seems legit', 'legit', 'respect',
  'respect +', 'mad respect', 'i respect it', 'honestly respect', 'can’t argue with that',
  'hard to argue', 'undeniable', 'say less', 'period', 'periodt', 'and that’s on that',
  'case closed', 'end of discussion', 'say it louder', 'SAY IT LOUDER', 'louder for the back',
  'preach', 'speak on it', 'spitting', 'spittin facts', 'wikipedia spitting', 'he’s right you know',
  'i’ve always said this', 'called it', 'CALLED IT', 'i knew it', 'i knew that', 'knew it',
  'told you guys', 'told yall', 'as expected', 'predictable', 'obviously', 'well duh', 'duh',
];

const DISAGREE = [
  'L', 'L take', 'huge L', 'massive L', 'L article', 'L sentence', 'take the L', 'ratio', 'ratio + L',
  'mid', 'kinda mid', 'mid sentence', 'mid article tbh', 'overrated', 'underrated', 'unpopular opinion',
  'hot take', 'cold take', 'lukewarm take', 'disagree', 'strongly disagree', 'nope', 'nah',
  'false', 'FALSE', 'wrong', 'that’s wrong', 'incorrect', 'debatable', 'questionable',
  'highly questionable', 'that’s a stretch', 'big if true', 'allegedly', 'reportedly', 'apparently',
  'so they say', 'or so they claim', 'i’ll believe it when i see it', 'skeptical', 'doubt',
  'X doubt', 'doubt 🤨', '🤨', '🤨🤨', '😒', '🙄', 'eh', 'meh', 'ok and?', 'and?', 'so?',
  'who cares', 'who asked', 'who asked (me, i asked)', 'nobody asked', 'i asked', 'ok boomer',
  'cringe', 'kinda cringe', 'based or cringe?', 'boring', 'snooze', '😴', 'zzz', 'yawn',
  'wake me up when it gets good', 'skip', 'skip this part', 'next', 'NEXT', 'boring section',
  'speed it up', 'faster', 'slower pls', 'too fast', 'too slow', 'pacing is off',
];

const EMOTES = [
  '👀', '👀👀', '👀👀👀', '🔥', '💯', '🙏', '🙌', '👏', '👏👏👏', '🫡', 'o7', 'o7 o7', '🤝',
  '❤️', '💜', '💜💜', '🫶', '😍', '🥹', '🥺', '😤', '😎', '🤠', '🥳', '🎉', '🎉🎉', '✨', '⭐',
  '🌟', '⚡', '🚀', '🚀🚀', '🌍', '🌎', '🌏', '🗿', '🗿🗿', '🐐', '🦆', '🐸', '🐢', '🦀', '🦀🦀🦀',
  '🍿', '🍿🍿', '☕', '🧃', '🥤', '🫠', '😵‍💫', '🤡', '👑', '💎', '🏆', '🎯', '📈', '📉', '🤌',
  '💅', '🧍', '🕺', '💃', '👁️👄👁️', '(╯°□°)╯︵ ┻━┻', '┬─┬ノ( º _ ºノ)', '¯\\_(ツ)_/¯', '( ͡° ͜ʖ ͡°)',
  'ʕ•ᴥ•ʔ', '(｡◕‿◕｡)', '(•_•)', '( •_•)>⌐■-■', '(⌐■_■)', '\\o/', 'ヽ(•‿•)ノ', '<3', '<333', ':)',
  ':D', 'xD', 'XD', ':O', 'D:', ':(', ';)', ':P', 'owo', 'uwu', '>:(', '^_^', '-_-', '._.',
];

const CHATTER_META = [
  'first', 'FIRST', 'first time chatter', 'first time here, love it', 'hi chat', 'hello chat',
  'hey everyone', 'yo', 'yooo', 'sup', 'hii', 'hiii chat', 'gm', 'gm chat', 'good morning chat',
  'good evening chat', 'gn chat', 'evening all', 'howdy', 'o/', 'hello from Brazil', 'hello from Norway',
  'hello from Japan', 'watching from work', 'watching from class 🤫', 'watching on my lunch break',
  'watching in the bathroom', 'watching instead of sleeping', 'it’s 4am here', 'it’s 2am and i’m learning',
  'can’t sleep, reading wikipedia', 'my cat is watching too', 'my dog says hi', 'my mom walked in',
  'my grandma loves this stream', 'showing this to my dad', 'just got off work', 'just woke up',
  'just tuned in', 'just got here', 'late again', 'did i miss anything', 'lurking', 'lurker here',
  'back from lurking', 'unlurking for this', 'had to unlurk', 'been here since the intro',
  'day one viewer', 'OG viewer', 'been watching since 2019', 'long time listener first time caller',
  'chat is fast today', 'chat is moving so fast nobody will see this', 'nobody will read this',
  'chat is slow today', 'chat woke up', 'chat is unhinged today', 'chat behave', 'chat calm down',
  'chat be nice', 'chat stop spamming', 'chat we learning', 'chat are we learning', 'chat i’m learning',
  'chat we’re so smart now', 'chat we’re cooked', 'chat we’re so back', 'chat is this a W',
  'chat say something', 'say W in chat', 'W in the chat', 'type 1 if you knew that', '1', '1111',
  '2', '22222', 'type 2 if you didn’t', 'raid incoming', 'thanks for the raid', 'who raided',
  'mods?', 'MODS', 'mods are asleep', 'mods sleeping post facts', 'mods ban this fact',
  'where are the mods', 'mods do something', 'streamer read chat', 'read chat',
  'streamer is ignoring us', 'notice me', 'notice me streamer', 'streamer pls', 'hi streamer',
  'love the stream', 'love this stream', 'best stream on the site', 'this is my comfort stream',
  'comfort stream', 'background stream while i work', 'perfect background noise', 'cozy stream',
  'cozy vibes', 'vibes', 'good vibes', 'immaculate vibes', 'vibe check', 'vibe check passed',
  'when’s the next stream', 'stream tomorrow?', 'how long is this article', 'are we reading all of it',
  'we’re reading the WHOLE thing?', 'how many sentences left', 'this article is long',
  'this is a long one', 'marathon stream', 'the endurance', 'streamer has stamina', 'hydrate streamer',
  'drink water', 'stay hydrated chat', 'posture check', 'posture check chat', 'stretch break?',
  'snack break', 'getting snacks brb', 'brb', 'back', 'back!', 'what did i miss', 'afk', 'afk 5 min',
];

const OFF_TOPIC = [
  'anyone else hungry', 'i want pizza now', 'what’s everyone eating', 'cereal for dinner again',
  'just burnt my toast', 'my coffee is cold', 'my tea went cold watching this', 'i should be sleeping',
  'i have work in 3 hours', 'my exam is tomorrow and i’m here', 'procrastinating so hard rn',
  'this is better than my homework', 'my wifi is dying', 'stream lagging for anyone else?',
  'lag?', 'no lag for me', 'buffering...', 'audio is fine', 'is it just me or', 'random but',
  'unrelated but', 'off topic but', 'quick question', 'anyone play chess?', 'who’s watching the game later',
  'what’s the weather like for yall', 'raining here', 'it’s snowing here', 'so hot today',
  'my plant is thriving', 'my cat just knocked over my drink', 'my dog is snoring', 'neighbors are loud',
  'birthday today 🎂', 'it’s my birthday!', 'happy birthday!', 'hbd', 'congrats!', 'congrats on the new job',
  'i got a new keyboard', 'what keyboard is that', 'what chair do you have', 'what’s your setup',
  'pineapple on pizza?', 'hot dog is a sandwich', 'cereal is soup', 'water is wet', 'is a straw one hole or two',
  'tabs or spaces', 'dark mode gang', 'light mode users scare me', 'cats > dogs', 'dogs > cats',
  'team cats', 'team dogs', 'frogs are underrated', 'crabs are the endgame', 'everything becomes crab eventually',
  'touch grass', 'i should touch grass', 'grass touched', 'outside? never heard of it', 'what’s outside',
];

const BACKSEAT = [
  'read the next part', 'skip to the good part', 'go back', 'go back a sentence', 'rewind',
  'read it slower', 'read it faster', 'speed run it', 'do the whole article', 'do a different article',
  'read the history section next', 'do the octopus one', 'do the emu war next', 'read about toast',
  'read about crabs next', 'next article: frogs', 'do tardigrades', 'read the see also section',
  'read the references (jk)', 'open the infobox', 'show the picture', 'click the link',
  'there’s a link to that', 'that has its own article', 'rabbit hole incoming', 'wikipedia rabbit hole time',
  'we’re going down the rabbit hole', 'click every blue link', 'six degrees to Kevin Bacon',
  'how many clicks to philosophy', 'all roads lead to philosophy', 'getting to philosophy speedrun',
  'random article next', 'hit the random button', 'roll the dice', '🎲', '🎲🎲🎲',
];

const COPYPASTA = [
  'I came here to learn and I am learning. My father learned. His father learned. 📚📚📚',
  'This is the most important thing I have ever read and I will not be taking questions.',
  'Hello, I am the Wikipedia editor who wrote that sentence. You are welcome. 🤓',
  'Every day we stray further from not reading Wikipedia articles out loud.',
  'I showed this to my teacher and now I am the teacher. 🎓',
  'Scientists HATE this one weird article. Number 4 will shock you.',
  'If you read this message you are legally required to learn one fact today.',
  'Me: I will sleep early tonight. Also me at 3am: reading about this.',
  'Nobody: Absolutely nobody: Wikipedia: one more paragraph.',
  'Chat, I have a confession. I have never once finished a Wikipedia article. Until today.',
  'This article has changed my life. I am selling my belongings and becoming a scholar.',
  'POV: you opened one tab and now you have 47 tabs open.',
  'Mom said it’s my turn to read the next sentence.',
  'I am not addicted to Wikipedia. I can stop any time. *opens another tab*',
  'They should teach this in schools. Wait, they do? Never mind.',
  'My therapist said I need a hobby. So I read Wikipedia with strangers now.',
  'Fun fact: you just read this message. Learning is so easy.',
  'Rate this article: ⭐⭐⭐⭐⭐ would read again.',
  'I would like to thank the academy, my parents, and whoever wrote this paragraph.',
  'If this sentence gets 100 W’s I will read the whole article myself.',
];

const MOD = [
  'reminder to keep chat on topic 📚', 'please be kind in chat everyone 💜', 'no spoilers for the next section',
  'reminder: no backseating the reading pace', 'chat rules: be nice, learn things', 'welcome new chatters!',
  'enjoy the stream everyone', 'keep it civil chat', 'please don’t spam the same message',
  'remember to hydrate', 'thanks for watching everyone', 'we love the editors here',
];

// ---------------------------------------------------------------------------
// Riffs on the sentence just read.
// ---------------------------------------------------------------------------

const KEYWORD = [
  '{w}??', '{w}?!', '{w} mentioned', '{w} mentioned 🗣️', '{W} {W} {W}', '{W}', '{w} W', '{w} L',
  'wait {w} is real?', 'not {w} 😭', '{w} fans where we at', '{w} fan club 🙋', 'i love {w}',
  'i hate {w}', '{w} is so underrated', '{w} is overrated tbh', 'big {w} energy', '{w} supremacy',
  '{w} gang', '{w} enjoyer', 'who is {w}', 'what is {w}', 'what’s a {w}', '{w} >>>', '{w} >> everything',
  'they said {w} 💀', 'bro said {w}', 'did he just say {w}', '{w} jumpscare', '{w} arc', 'the {w} arc begins',
  '{w} lore', '{w} lore goes deep', 'never heard of {w}', 'first time hearing about {w}', '{w} is my favorite',
  'my dad loves {w}', '{w} cinematic universe', '{w} speedrun', 'peak {w}', '{w} propaganda', 'not {w} again',
  '{w} 🔥', '{w} 💀', '{w} 👀', '{w} 🤝', 'respect to {w}', 'pray for {w} 🙏', '{w} carried', '{w} diff',
  'imagine being {w}', 'live {w} reaction', '{w} would never', 'type {w} in chat', '{w} in the chat',
  '{W} MENTIONED', 'say {w} one more time', 'i read that as {w} 2', 'need a {w} documentary', 'more {w} pls',
];

const YEAR = [
  '{y} was a crazy year', 'not {y} 💀', '{y} 😭', 'in {y}??', '{y} was wild', 'imagine living in {y}',
  'my grandpa remembers {y}', 'i was born in {y} (jk)', '{y} vibes', 'back in {y} 👴', '{y} was so long ago',
  '{y} was like yesterday', '{y} kids where you at', '{y} speedrun', 'what else happened in {y}',
  'in this economy? in {y}?', '{y} hits different', 'take me back to {y}', '{y} was peak', '{y} arc',
];

const NUMBER = [
  '{n}??', '{n}?!', 'only {n}?', '{n} is crazy', '{n} 💀', '{N} WHAT', 'that’s like {n} footballs',
  'how many is {n} in bananas', '{n} is a lot', '{n} is not a lot actually', 'round it up to {n}0',
  '{n}! nice', 'i would have guessed {n}0', 'that number is fake', 'source on {n}?', 'counting... {n}',
  'more than {n}?', 'less than {n}?', '{n} of them??', 'math checks out', 'calculator noises',
];

/** Topic triggers: if the last sentence matches, sometimes react on-theme. */
const TOPICS: Array<[RegExp, string[]]> = [
  [/\b(war|battle|army|soldiers?|invasion|military|siege|troops)\b/i, ['⚔️', '⚔️⚔️⚔️', 'war arc', 'not the war 😭', 'peace was never an option', 'who won though', 'diplomacy failed', 'o7 soldiers', 'history class flashbacks', 'strategy game vibes']],
  [/\b(died|death|killed|dead|executed|murdered|perished|buried)\b/i, ['o7', 'F', 'F in chat', 'F F F', 'rip', 'RIP', 'rest in peace 🕊️', '😔', 'press F', 'gone too soon', 'oof', 'pain', 'sad']],
  [/\b(born|birth|childhood|infant)\b/i, ['happy birthday!', 'baby arc', 'origin story', 'the origin story', 'and so it begins', 'tiny baby 🥺']],
  [/\b(king|queen|emperor|empress|prince|princess|pharaoh|dynasty|throne|crown)\b/i, ['👑', 'royalty', 'long live the king', 'bow down', 'kneel', 'throne arc', 'royal drama incoming', 'monarchy lore']],
  [/\b(food|eat|eaten|bread|cook|cooking|dish|cuisine|recipe|meal|fruit|toast|cheese)\b/i, ['now i’m hungry', '😋', '🍞', 'yummy', 'snack time', 'recipe pls', 'chef mode', 'i would eat that', 'food arc', 'getting snacks brb']],
  [/\b(space|planet|star|stars|galaxy|orbit|moon|mars|nasa|spacecraft|solar|universe|telescope)\b/i, ['🚀', '🚀🚀🚀', '🌌', 'space W', 'to infinity', 'we’re so small', 'aliens confirmed?', 'astronaut arc', 'space is so cool', 'houston we have a W']],
  [/\b(species|animals?|mammal|bird|fish|insect|predator|prey|habitat|wild|tentacles?|arms|limbs)\b/i, ['nature is metal', 'nature is wild', 'nature doc vibes', 'cute', 'so cute', 'i want one', 'can i pet it', 'pet it', 'animal facts W', '🐾']],
  [/\b(million|billion|trillion|money|dollars?|price|cost|economy|wealth|rich|gold)\b/i, ['💰', '💸', 'stonks', 'money money', 'how much??', 'in this economy?', 'i’m broke', 'rich people things', 'big money', 'that’s a lot of money']],
  [/\b(science|scientists?|research|experiment|study|studies|theory|hypothesis|discovered|discovery)\b/i, ['science W', 'for science', '🧪', '🔬', 'scientists did it again', 'peer review this', 'the science is in', 'lab coat on 🥼', 'trust the process']],
  [/\b(music|song|album|band|singer|guitar|concert|tour)\b/i, ['🎵', '🎶', 'banger', 'add it to the playlist', 'bops', 'music W', 'concert when', '🎸', 'one more song']],
  [/\b(game|games|sport|football|soccer|olympics?|championship|team|player|tournament)\b/i, ['⚽', '🏆', 'GG', 'gg ez', 'skill issue', 'carried', 'MVP', 'clutch', 'what a play']],
  [/\b(ocean|sea|water|river|lake|island|coast|marine|underwater)\b/i, ['🌊', '🌊🌊', 'ocean W', 'fish facts', 'blub', 'blub blub', 'swimming arc', 'deep sea is scary']],
  [/\b(computer|internet|software|technology|digital|robot|machine)\b/i, ['🤖', 'beep boop', 'tech W', 'have you tried turning it off and on', 'nerd stuff', 'the robots are coming']],
  [/\b(largest|biggest|longest|tallest|oldest|first|fastest|smallest)\b/i, ['record breaking', 'world record?', 'no way it’s the biggest', 'goated stat', 'number one', 'top tier', 'S tier']],
];

const SPAM_EMOJI = ['📚', '🔥', '💀', 'W', '🧠', '😭', '🤓', '👀', '❗', '🗿', '🦀', '🙏', '💯', '✨', 'L', '🚀', '👏', '?', 'o7', 'LMAO'];

// Weighted pool of groups for the generic case.
const GROUPS: Array<[number, readonly string[]]> = [
  [14, HYPE], [12, DISBELIEF], [10, LAUGH], [8, CONFUSED], [12, NERD], [10, AGREE],
  [6, DISAGREE], [8, EMOTES], [10, CHATTER_META], [4, OFF_TOPIC], [4, BACKSEAT], [1, COPYPASTA],
];
const GROUP_TOTAL = GROUPS.reduce((n, [w]) => n + w, 0);

function genericLine() {
  let r = Math.random() * GROUP_TOTAL;
  for (const [w, lines] of GROUPS) if ((r -= w) < 0) return pick(lines);
  return pick(HYPE);
}

const STOPWORDS = new Set(['The', 'This', 'That', 'These', 'Those', 'There', 'Their', 'They', 'When', 'While', 'Where', 'Which', 'With', 'After', 'Before', 'During', 'Since', 'Although', 'However', 'Many', 'Some', 'Most', 'Other', 'Such', 'Also', 'From', 'Into', 'About', 'Over', 'Under', 'Between', 'Both', 'Each', 'Like', 'Unlike']);

function fill(template: string, sentence: string, someone?: string): string | null {
  if (template.includes('{w}') || template.includes('{W}')) {
    const words = (sentence.match(/\b\p{Lu}[\p{L}'’-]{3,}/gu) ?? []).filter((w) => !STOPWORDS.has(w));
    if (!words.length) return null;
    const w = pick(words);
    template = template.replaceAll('{w}', w).replaceAll('{W}', w.toUpperCase());
  }
  if (template.includes('{y}')) {
    const years = sentence.match(/\b(1[0-9]{3}|20[0-9]{2})\b/g);
    if (!years) return null;
    template = template.replaceAll('{y}', pick(years));
  }
  if (template.includes('{n}') || template.includes('{N}')) {
    const nums = sentence.match(/\b\d+(?:[.,]\d+)?\b/g)?.filter((n) => !/^(1[0-9]{3}|20[0-9]{2})$/.test(n));
    if (!nums?.length) return null;
    const n = pick(nums);
    template = template.replaceAll('{n}', n).replaceAll('{N}', n.toUpperCase());
  }
  if (template.includes('{u}')) {
    if (!someone) return null;
    template = template.replaceAll('{u}', someone);
  }
  return template;
}

const MENTIONS = [
  '@{u} real', '@{u} true', '@{u} facts', '@{u} no shot', '@{u} 💀', '@{u} LMAO', '@{u} based',
  '@{u} ratio', '@{u} W take', '@{u} L take', '@{u} what', '@{u} ??', '@{u} source?', '@{u} you’re so right',
  '@{u} touch grass', '@{u} nerd 🤓', '@{u} agreed', '@{u} same', '@{u} hi!', '@{u} welcome back',
  '@{u} how did you know that', '@{u} explain', '@{u} relax', '@{u} chill', '@{u} lol', '@{u} 😭',
];

const recent: string[] = [];
const RECENT_MAX = 40;

/**
 * Pick a filler message. `lastSentence` lets chat riff on what was just read;
 * `someone` is another chatter's name for the occasional @-mention.
 */
export function reaction(lastSentence = '', someone?: string): string {
  for (let attempt = 0; attempt < 8; attempt++) {
    const line = candidate(lastSentence, someone);
    if (line && !recent.includes(line)) {
      recent.push(line);
      if (recent.length > RECENT_MAX) recent.shift();
      return line;
    }
  }
  return genericLine();
}

function candidate(sentence: string, someone?: string): string | null {
  const r = Math.random();
  if (sentence) {
    if (r < 0.1) {
      for (const [re, lines] of TOPICS) if (re.test(sentence)) return pick(lines);
    }
    if (r < 0.2) return fill(pick(KEYWORD), sentence);
    if (r < 0.25) return fill(pick(YEAR), sentence) ?? fill(pick(NUMBER), sentence);
    if (r < 0.28) return fill(pick(NUMBER), sentence);
    if (r < 0.3 && sentence.length > 220) return pick(['tl;dr', 'bro wrote an essay', 'that sentence had chapters', 'longest sentence ever', 'breathe', 'commas: the article', 'run-on sentence detected']);
  }
  if (r < 0.36) return fill(pick(MENTIONS), sentence, someone);
  if (r < 0.37) return pick(MOD);
  if (r < 0.47) {
    const e = pick(SPAM_EMOJI);
    return Array.from({ length: 2 + Math.floor(Math.random() * 7) }, () => e).join(' ');
  }
  return genericLine();
}

/** Total distinct static lines, for curiosity / the README. */
export const REACTION_COUNT =
  GROUPS.reduce((n, [, l]) => n + l.length, 0) + MOD.length + KEYWORD.length + YEAR.length + NUMBER.length +
  MENTIONS.length + TOPICS.reduce((n, [, l]) => n + l.length, 0);
