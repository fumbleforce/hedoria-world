/** Live-stream quick actions (ActionBar → Actions menu). */

export interface LiveQuickAction {
  label: string;
  prompt: string;
  minIntensity?: number;
}

export const LIVE_ACTIONS: LiveQuickAction[] = [
  { label: "😂 Tell a joke", prompt: "tell chat a genuinely funny joke" },
  { label: "💬 Chat with viewers", prompt: "chat casually with viewers, answering what they're saying" },
  { label: "❓ Answer questions (Q&A)", prompt: "take and answer questions from chat" },
  { label: "📖 Tell a story", prompt: "tell chat an entertaining story from your week" },
  { label: "🎤 Sing a song", prompt: "sing a song for chat" },
  { label: "💃 Dance", prompt: "put on a song and dance for chat" },
  { label: "📺 React to a video", prompt: "pull up a trending video and react to it with chat" },
  { label: "🫧 Open up / get personal", prompt: "get a little vulnerable and share something personal" },
  { label: "🙏 Thank a supporter", prompt: "give a heartfelt shout-out to a generous viewer by name" },
  { label: "😏 Flirt with chat", prompt: "flirt and tease chat playfully", minIntensity: 1 },
  { label: "🔥 Something daring", prompt: "lean into a bold, daring, suggestive moment for the crowd", minIntensity: 2 },
];
