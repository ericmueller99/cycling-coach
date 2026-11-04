export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

export interface ModelChoice {
  model: string;
  effort: Effort;
}

/** Which model does which job (DECISIONS #65, #69). */
export interface ModelRouter {
  /** Everyday coaching. */
  chat: ModelChoice;
  /** Plans and workouts. The same model as `chat` means one model and no routing. */
  build: ModelChoice;
  /** Thread titles and the food calls. */
  small: string;
}

/** The models that can hold a coach turn, and those for the small jobs. All priced in `pricing.ts`. */
export const COACH_MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5'] as const;
export const SMALL_MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5'] as const;

export const DEFAULT_ROUTER: ModelRouter = {
  chat: { model: 'claude-sonnet-5-5', effort: 'medium' },
  build: { model: 'claude-opus-5-5', effort: 'medium' },
  small: 'claude-haiku-5-5',
};

/** Asked at the start of each turn and call, so a change applies to the next one and never mid-turn. */
export type RouterSource = () => ModelRouter | Promise<ModelRouter>;

export const defaultRouter: RouterSource = () => DEFAULT_ROUTER;

/** Routing needs two models; the efforts alone don't make a route. */
export const routes = (router: ModelRouter) => router.build.model !== router.chat.model;
