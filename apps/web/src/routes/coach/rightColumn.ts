/**
 * The Coach page's right column — Today rail, recipe pane or idea Details — is always 420 px
 * (DECISIONS #46), so the chat doesn't shift as panes open and close, and `min-w-0` stops wide
 * content from stretching it. It sits beside the chat once the page's @container fits both
 * (the chat's 520 px basis + 420 = 940); narrower, it wraps under the chat at full width.
 */
export const RIGHT_COL =
  'box-border w-full min-w-0 flex-[1_1_100%] @min-[940px]:w-[420px] @min-[940px]:flex-[0_0_420px] @min-[940px]:sticky @min-[940px]:top-0 @min-[940px]:h-dvh @min-[940px]:self-start';
