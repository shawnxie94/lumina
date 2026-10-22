export interface PollEnvironment {
	setTimer: (
		callback: () => void,
		delay: number,
	) => ReturnType<typeof setTimeout>;
	clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
	visible: () => boolean;
	subscribe: (callback: () => void) => () => void;
}

const browserEnvironment: PollEnvironment = {
	setTimer: (callback, delay) => setTimeout(callback, delay),
	clearTimer: (timer) => clearTimeout(timer),
	visible: () => typeof document === "undefined" || !document.hidden,
	subscribe: (callback) => {
		if (typeof document === "undefined") return () => {};
		document.addEventListener("visibilitychange", callback);
		return () => document.removeEventListener("visibilitychange", callback);
	},
};

/** Completion-delayed polling. Disposing rejects results without requiring transport cancellation. */
export function startSerialPolling<T>(
	options: {
		load: () => Promise<T>;
		apply: (value: T) => void;
		terminal: (value: T) => boolean;
		delay: number;
		immediate?: boolean;
		onError?: (error: unknown) => void;
	},
	environment: PollEnvironment = browserEnvironment,
): () => void {
	let disposed = false;
	let stopped = false;
	let inflight = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const clear = () => {
		if (timer !== undefined) environment.clearTimer(timer);
		timer = undefined;
	};
	const schedule = () => {
		clear();
		if (!disposed && !stopped && environment.visible()) {
			timer = environment.setTimer(() => {
				timer = undefined;
				void tick();
			}, options.delay);
		}
	};
	const tick = async () => {
		if (disposed || stopped || inflight || !environment.visible()) return;
		inflight = true;
		try {
			const value = await options.load();
			if (disposed) return;
			options.apply(value);
			stopped = options.terminal(value);
		} catch (error) {
			if (!disposed) options.onError?.(error);
		} finally {
			inflight = false;
			schedule();
		}
	};
	const unsubscribe = environment.subscribe(() => {
		clear();
		if (environment.visible() && !inflight) schedule();
	});
	if (options.immediate) void tick();
	else schedule();
	return () => {
		disposed = true;
		clear();
		unsubscribe();
	};
}
