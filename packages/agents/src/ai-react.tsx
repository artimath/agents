import { useChat } from "@ai-sdk/react";
import type { Message } from "ai";
import { useAgent } from "./react";
import { useEffect, use } from "react";
import type { OutgoingMessage } from "./ai-types";

/**
 * Options for the useAgentChat hook
 * @interface UseAgentChatOptions
 */
type UseAgentChatOptions = Omit<
  Parameters<typeof useChat>[0] & {
    /** Agent connection from useAgent */
    agent: ReturnType<typeof useAgent>;
    /** User ID for message attribution */
    userId?: string;
  },
  "fetch"
>;

// Cache for initial message fetches to prevent redundant requests
const requestCache = new Map<string, Promise<Message[]>>();

/**
 * React hook for building AI chat interfaces using an Agent
 * @param options Chat options including agent connection and userId
 * @returns Chat interface controls with state management and history clearing
 */
export function useAgentChat(options: UseAgentChatOptions) {
  const { agent, userId, ...rest } = options;

  // Construct URL for fetching initial messages
  const url =
    agent._pkurl.replace("ws://", "http://").replace("wss://", "https://") +
    "/get-messages";

  // Fetch initial messages with caching
  const initialMessages = use(
    (() => {
      if (requestCache.has(url)) {
        return requestCache.get(url)!;
      }
      const promise = fetch(new Request(url)).then((res) => res.json()) as Promise<Message[]>;
      requestCache.set(url, promise);
      return promise;
    })(),
  );

  // Custom fetch function using WebSocket for AI responses
  async function aiFetch(request: RequestInfo | URL, options: RequestInit = {}): Promise<Response> {
    const {
      method = "POST",
      keepalive,
      headers,
      body,
      redirect,
      integrity,
      signal,
      credentials,
      mode,
      referrer,
      referrerPolicy,
      window,
    } = options;

    const id = crypto.randomUUID();
    const abortController = new AbortController();

    signal?.addEventListener("abort", () => {
      abortController.abort();
    });

    let controller: ReadableStreamDefaultController;

    const stream = new ReadableStream({
      start(c) {
        controller = c;
      },
    });

    // Handle incoming WebSocket messages
    agent.addEventListener(
      "message",
      (event) => {
        const data = JSON.parse(event.data) as OutgoingMessage;
        if (data.type === "cf_agent_use_chat_response" && data.id === id) {
          controller.enqueue(new TextEncoder().encode(data.body));
          if (data.done) {
            controller.close();
            abortController.abort();
          }
        }
      },
      { signal: abortController.signal },
    );

    // Parse and update body with userId if provided
    let updatedBody = body;
    if (body && userId) {
      try {
        const parsedBody = JSON.parse(body as string);
        updatedBody = JSON.stringify({ ...parsedBody, userId });
      } catch (e) {
        console.warn("Failed to parse body for userId injection:", e);
      }
    }

    // Send chat request over WebSocket
    agent.send(
      JSON.stringify({
        type: "cf_agent_use_chat_request",
        id,
        url: request.toString(),
        init: {
          method,
          keepalive,
          headers,
          body: updatedBody || body,
          redirect,
          integrity,
          credentials,
          mode,
          referrer,
          referrerPolicy,
          window,
        },
      }),
    );

    return new Response(stream);
  }

  const useChatHelpers = useChat({
    initialMessages,
    sendExtraMessageFields: true,
    fetch: aiFetch,
    ...rest,
  });

  // Initialize WebSocket connection and handle events
  useEffect(() => {
    agent.send(
      JSON.stringify({
        type: "cf_agent_chat_init",
      }),
    );

    function onClearHistory(event: MessageEvent) {
      const data = JSON.parse(event.data) as OutgoingMessage;
      if (data.type === "cf_agent_chat_clear") {
        useChatHelpers.setMessages([]);
      }
    }

    function onMessages(event: MessageEvent) {
      const data = JSON.parse(event.data) as OutgoingMessage;
      if (data.type === "cf_agent_chat_messages") {
        useChatHelpers.setMessages(data.messages);
      }
    }

    agent.addEventListener("message", onClearHistory);
    agent.addEventListener("message", onMessages);

    return () => {
      agent.removeEventListener("message", onClearHistory);
      agent.removeEventListener("message", onMessages);
    };
  }, [agent, useChatHelpers]);

  return {
    ...useChatHelpers,
    /**
     * Set chat messages and sync with Agent
     * @param messages New messages to set
     */
    setMessages: (messages: Message[]) => {
      useChatHelpers.setMessages(messages);
      agent.send(
        JSON.stringify({
          type: "cf_agent_chat_messages",
          messages,
        }),
      );
    },
    /**
     * Clear chat history on client and Agent
     */
    clearHistory: () => {
      useChatHelpers.setMessages([]);
      agent.send(
        JSON.stringify({
          type: "cf_agent_chat_clear",
        }),
      );
    },
  };
}