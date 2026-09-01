"use client";
import { useAuth0 } from "@auth0/auth0-react";
import Navbar from "../navbar";
import { useEffect, useState, useRef, useCallback } from "react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import { Check, CheckCheck, CircleAlert, LoaderCircle, Send } from "lucide-react";

import { useAuthSession } from "../auth/AuthBootstrap";

type ChatMessage = {
    id: string;
    turnId: string | null;
    clientMessageId: string | null;
    content: string;
    sender: "user" | "assistant" | "system";
    createdAt: string;
    source: "web" | "android" | "ios" | "system";
    messageKind: "chat" | "reminder";
    partIndex: number | null;
    status: "sending" | "sent" | "seen" | "delivered" | "failed";
};

type PrimaryConversation = {
    id: string;
    title: "Cantarella";
    lastMessageAt: string | null;
    unreadCount: number;
};

type MessageHistoryPage = {
    messages: ChatMessage[];
    nextCursor: string | null;
    hasMore: boolean;
};

type ApiError = {
    error?: {
        message?: string;
    };
};

type ConversationEvent =
    | { type: "turn.status"; data: { turnId: string; status: "thinking" | "voicing" } }
    | { type: "typing.started" | "typing.stopped"; data: { conversationId: string; sender: "assistant" } }
    | { type: "message.created"; data: { message: ChatMessage } }
    | { type: "turn.completed"; data: { turnId: string } }
    | { type: "turn.failed"; data: { turnId: string; code: string; message: string; retryable: boolean } }
    | { type: "connected"; data: { conversationId: string } };

async function readApiError(response: Response, fallback: string) {
    const payload = await response.json().catch(() => null) as ApiError | null;
    return payload?.error?.message ?? fallback;
}

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
    const incomingClientIds = new Set(
        incoming.map((message) => message.clientMessageId).filter(Boolean),
    );
    const byId = new Map<string, ChatMessage>();

    for (const message of current) {
        if (
            message.id.startsWith("pending-") &&
            message.clientMessageId &&
            incomingClientIds.has(message.clientMessageId)
        ) continue;

        byId.set(message.id, message);
    }

    for (const message of incoming) byId.set(message.id, message);

    return [...byId.values()].sort(compareChatMessages);
}

function compareChatMessages(left: ChatMessage, right: ChatMessage) {
    const timeDifference = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    if (timeDifference !== 0) return timeDifference;

    const senderOrder = { user: 0, assistant: 1, system: 2 } as const;
    const senderDifference = senderOrder[left.sender] - senderOrder[right.sender];
    if (senderDifference !== 0) return senderDifference;

    if (
        left.turnId &&
        left.turnId === right.turnId &&
        left.partIndex !== null &&
        right.partIndex !== null
    ) {
        const partDifference = left.partIndex - right.partIndex;
        if (partDifference !== 0) return partDifference;
    }

    return left.id.localeCompare(right.id);
}

function stagedBubbleDelay(message: ChatMessage) {
    return Math.min(1_300, Math.max(550, 350 + message.content.length * 12));
}

function showAssistantNotification(message: ChatMessage) {
    if (
        message.sender !== "assistant" ||
        message.partIndex !== 0 ||
        !document.hidden ||
        !("Notification" in window) ||
        Notification.permission !== "granted"
    ) return;

    const notification = new Notification("Cantarella", {
        body: message.content,
        tag: `cantarella-message-${message.id}`,
    });

    notification.onclick = () => {
        window.focus();
        notification.close();
    };
}

async function consumeEventStream(
    response: Response,
    onEvent: (event: ConversationEvent) => void,
) {
    if (!response.body) throw new Error("Conversation event stream is unavailable");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
            const lines = frame.split("\n");
            const eventType = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
            const data = lines
                .filter((line) => line.startsWith("data:"))
                .map((line) => line.slice(5).trim())
                .join("\n");

            if (!eventType || !data) continue;
            onEvent({ type: eventType, data: JSON.parse(data) } as ConversationEvent);
        }
    }
}

function getSafeDate(timeStr: string) {
    if (!timeStr) return new Date();
    let normalized = timeStr.trim();
    if (normalized.includes(" ")) normalized = normalized.replace(" ", "T");
    if (!normalized.endsWith("Z")) normalized += "Z";
    return new Date(normalized);
}

function getBKK(date: Date) {
    return date.toLocaleDateString("en-US", { timeZone: "Asia/Bangkok" });
}

function formatDateDivider(timeStr: string) {
    const date = getSafeDate(timeStr);
    const now = new Date();
    if (getBKK(date) === getBKK(now)) return "Today";
    if (getBKK(date) === getBKK(new Date(now.getTime() - 86400000))) return "Yesterday";
    return date.toLocaleDateString("en-US", { timeZone: "Asia/Bangkok", weekday: "long", month: "short", day: "numeric" });
}

function formatMessageTime(timeStr: string) {
    if (!timeStr) return "";
    return getSafeDate(timeStr).toLocaleTimeString("en-US", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" });
}

function isDeepSeekPeakTime(now: Date) {
    const day = now.getUTCDay();
    if (day === 0 || day === 6) return false;

    const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    return (minutes >= 60 && minutes < 240) || (minutes >= 360 && minutes < 600);
}

function getDeepSeekPeakEnd(now: Date): Date | null {
    const day = now.getUTCDay();
    if (day === 0 || day === 6) return null;

    const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    if (minutes >= 60 && minutes < 240) {
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 4));
    }
    if (minutes >= 360 && minutes < 600) {
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 10));
    }
    return null;
}

function formatLocalTime(date: Date, timeZone: string) {
    return new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).format(date);
}

function formatLocalPeakSchedule(timeZone: string) {
    const format = (hour: number) => formatLocalTime(
        new Date(Date.UTC(2026, 8, 7, hour, 0)),
        timeZone,
    );

    return `${format(1)}–${format(4)} · ${format(6)}–${format(10)} on weekdays`;
}

function MessageStatus({ status }: { status: ChatMessage["status"] }) {
    if (status === "sending") {
        return (
            <span aria-label="Sending" title="Sending" className="inline-flex text-[var(--text-dim)]">
                <LoaderCircle className="h-3 w-3 animate-spin" strokeWidth={1.7} />
            </span>
        );
    }

    if (status === "seen") {
        return (
            <span aria-label="Seen" title="Seen" className="inline-flex text-[var(--amber-soft)]">
                <CheckCheck className="h-3.5 w-3.5" strokeWidth={1.7} />
            </span>
        );
    }

    if (status === "failed") {
        return (
            <span aria-label="Cantarella couldn't respond" title="Cantarella couldn't respond" className="inline-flex text-red-400">
                <CircleAlert className="h-3.5 w-3.5" strokeWidth={1.8} />
            </span>
        );
    }

    return (
        <span aria-label="Sent" title="Sent" className="inline-flex text-[var(--text-dim)]">
            <Check className="h-3 w-3" strokeWidth={1.7} />
        </span>
    );
}

export default function Page() {
    const { getAccessTokenSilently, isAuthenticated } = useAuth0();
    const { account } = useAuthSession();
    const [message, setMessage] = useState("");
    const [now, setNow] = useState(() => new Date());
    const [messageList, setMessageList] = useState<ChatMessage[]>([]);
    const [isTyping, setIsTyping] = useState(false);
    const [isInitialLoaded, setIsInitialLoaded] = useState(false);
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const isLoadingMoreRef = useRef(false);
    const START_INDEX = 100000;
    const [firstItemIndex, setFirstItemIndex] = useState(START_INDEX);
    const firstItemIndexRef = useRef(START_INDEX);
    const virtuoso = useRef<VirtuosoHandle>(null);
    const isAtBottomRef = useRef(true);
    const shouldRevealTypingRef = useRef(false);
    const typingRevealTimerRef = useRef<number | null>(null);
    const stagedMessagesRef = useRef<ChatMessage[]>([]);
    const stagedDeliveryTimerRef = useRef<number | null>(null);
    const backendTypingActiveRef = useRef(false);
    const messageListRef = useRef<ChatMessage[]>([]);
    const seenTurnIdsRef = useRef(new Set<string>());
    const failedTurnIdsRef = useRef(new Set<string>());
    const messageInputRef = useRef<HTMLTextAreaElement>(null);
    messageListRef.current = messageList;

    const userTimeZone = account?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
    const isPeakTime = isDeepSeekPeakTime(now);
    const showPeakPricingAlert = true;
    const peakEndsAt = getDeepSeekPeakEnd(now);

    useEffect(() => {
        const timer = window.setInterval(() => setNow(new Date()), 30_000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        const input = messageInputRef.current;
        if (!input) return;

        input.style.height = "0px";
        input.style.height = `${Math.min(input.scrollHeight, 144)}px`;
    }, [message]);

    useEffect(() => {
        if (!isAuthenticated) return;

        let cancelled = false;

        const run = async () => {
            try {
                const token = await getAccessTokenSilently();
                const conversationResponse = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/conversations/primary`, {
                    headers: { Authorization: `Bearer ${token}` },
                });

                if (!conversationResponse.ok) {
                    throw new Error(await readApiError(conversationResponse, "Failed to open conversation"));
                }

                const conversationPayload = await conversationResponse.json() as { data: PrimaryConversation };
                const historyResponse = await fetch(
                    `${process.env.NEXT_PUBLIC_API_URL}/api/v1/conversations/${conversationPayload.data.id}/messages?limit=50`,
                    { headers: { Authorization: `Bearer ${token}` } },
                );

                if (!historyResponse.ok) {
                    throw new Error(await readApiError(historyResponse, "Failed to load messages"));
                }

                const historyPayload = await historyResponse.json() as { data: MessageHistoryPage };

                if (cancelled) return;

                const batch = historyPayload.data.messages;
                setConversationId(conversationPayload.data.id);
                setMessageList(batch);
                setNextCursor(historyPayload.data.nextCursor);
                setHasMore(historyPayload.data.hasMore);
                setFirstItemIndex(START_INDEX);
                firstItemIndexRef.current = START_INDEX;
                setTimeout(() => {
                    if (cancelled) return;
                    setIsInitialLoaded(true);
                    if (batch.length > 0) {
                        virtuoso.current?.scrollToIndex({ index: batch.length - 1, align: "end" });
                    }
                }, 50);
            } catch (e) {
                console.error(e);
                if (!cancelled) setIsInitialLoaded(true);
            }
        };

        run();

        return () => {
            cancelled = true;
        };
    }, [getAccessTokenSilently, isAuthenticated]);

    useEffect(() => {
        if (!isAuthenticated || !conversationId) return;

        const controller = new AbortController();
        let cancelled = false;

        const clearTypingRevealTimer = () => {
            if (typingRevealTimerRef.current === null) return;
            window.clearTimeout(typingRevealTimerRef.current);
            typingRevealTimerRef.current = null;
        };

        const finishTypingWhenSettled = () => {
            if (
                !backendTypingActiveRef.current &&
                stagedMessagesRef.current.length === 0
            ) {
                setIsTyping(false);
            }
        };

        const scheduleStagedMessage = () => {
            if (
                stagedDeliveryTimerRef.current !== null ||
                stagedMessagesRef.current.length === 0
            ) return;

            setIsTyping(true);
            const nextMessage = stagedMessagesRef.current[0];
            if (!nextMessage) return;

            stagedDeliveryTimerRef.current = window.setTimeout(() => {
                stagedDeliveryTimerRef.current = null;
                const deliveredMessage = stagedMessagesRef.current.shift();
                if (deliveredMessage) {
                    setMessageList((current) => mergeMessages(current, [deliveredMessage]));
                }

                if (stagedMessagesRef.current.length > 0) {
                    scheduleStagedMessage();
                } else {
                    finishTypingWhenSettled();
                }
            }, stagedBubbleDelay(nextMessage));
        };

        const handleEvent = (event: ConversationEvent) => {
            if (event.type === "turn.status") {
                seenTurnIdsRef.current.add(event.data.turnId);
                failedTurnIdsRef.current.delete(event.data.turnId);
                setMessageList((current) => current.map((message) =>
                    message.sender === "user" && message.turnId === event.data.turnId
                        ? { ...message, status: "seen" }
                        : message
                ));
                if (event.data.status === "thinking") {
                    backendTypingActiveRef.current = true;
                    clearTypingRevealTimer();
                    shouldRevealTypingRef.current = isAtBottomRef.current;
                    typingRevealTimerRef.current = window.setTimeout(() => {
                        typingRevealTimerRef.current = null;
                        setIsTyping(true);
                    }, 120);
                }
            }
            if (event.type === "typing.started") {
                backendTypingActiveRef.current = true;
                clearTypingRevealTimer();
                shouldRevealTypingRef.current = isAtBottomRef.current;
                setIsTyping(true);
            }
            if (
                event.type === "typing.stopped" ||
                event.type === "turn.completed"
            ) {
                backendTypingActiveRef.current = false;
                clearTypingRevealTimer();
                finishTypingWhenSettled();
            }
            if (event.type === "message.created") {
                const createdMessage = event.data.message;
                showAssistantNotification(createdMessage);
                if (
                    createdMessage.sender === "assistant" &&
                    createdMessage.partIndex !== null &&
                    createdMessage.partIndex > 0
                ) {
                    stagedMessagesRef.current.push(createdMessage);
                    stagedMessagesRef.current.sort(compareChatMessages);
                    scheduleStagedMessage();
                } else {
                    setMessageList((current) => mergeMessages(current, [createdMessage]));
                }
            }
            if (event.type === "turn.failed") {
                failedTurnIdsRef.current.add(event.data.turnId);
                seenTurnIdsRef.current.delete(event.data.turnId);
                backendTypingActiveRef.current = false;
                clearTypingRevealTimer();
                if (stagedDeliveryTimerRef.current !== null) {
                    window.clearTimeout(stagedDeliveryTimerRef.current);
                    stagedDeliveryTimerRef.current = null;
                }
                stagedMessagesRef.current = [];
                setIsTyping(false);
                setMessageList((current) => current.map((message) =>
                    message.sender === "user" && message.turnId === event.data.turnId
                        ? { ...message, status: "failed" }
                        : message
                ));
                console.error(`${event.data.code}: ${event.data.message}`);
            }
        };

        const synchronizeLatest = async (token: string) => {
            const response = await fetch(
                `${process.env.NEXT_PUBLIC_API_URL}/api/v1/conversations/${conversationId}/messages?limit=50`,
                {
                    headers: { Authorization: `Bearer ${token}` },
                    signal: controller.signal,
                },
            );

            if (!response.ok) return;
            const payload = await response.json() as { data: MessageHistoryPage };
            if (!cancelled) {
                setMessageList((current) => mergeMessages(current, payload.data.messages));
            }
        };

        const connect = async () => {
            let retryDelay = 500;

            while (!cancelled) {
                try {
                    const token = await getAccessTokenSilently();
                    await synchronizeLatest(token);
                    const response = await fetch(
                        `${process.env.NEXT_PUBLIC_API_URL}/api/v1/conversations/${conversationId}/events`,
                        {
                            headers: {
                                Authorization: `Bearer ${token}`,
                                Accept: "text/event-stream",
                            },
                            signal: controller.signal,
                        },
                    );

                    if (!response.ok) {
                        throw new Error(await readApiError(response, "Conversation events disconnected"));
                    }

                    retryDelay = 500;
                    await consumeEventStream(response, handleEvent);
                } catch (error) {
                    if (cancelled || controller.signal.aborted) return;
                    console.error(error);
                }

                await new Promise((resolve) => setTimeout(resolve, retryDelay));
                retryDelay = Math.min(retryDelay * 2, 5_000);
            }
        };

        void connect();

        return () => {
            cancelled = true;
            clearTypingRevealTimer();
            if (stagedDeliveryTimerRef.current !== null) {
                window.clearTimeout(stagedDeliveryTimerRef.current);
                stagedDeliveryTimerRef.current = null;
            }
            stagedMessagesRef.current = [];
            backendTypingActiveRef.current = false;
            controller.abort();
        };
    }, [conversationId, getAccessTokenSilently, isAuthenticated]);

    useEffect(() => {
        if (!isTyping || !shouldRevealTypingRef.current) return;

        const animationFrame = window.requestAnimationFrame(() => {
            virtuoso.current?.scrollTo({
                top: Number.MAX_SAFE_INTEGER,
                behavior: "smooth",
            });
        });

        return () => window.cancelAnimationFrame(animationFrame);
    }, [isTyping]);

    const loadMore = useCallback(async () => {
        if (
            !isInitialLoaded ||
            !conversationId ||
            !hasMore ||
            !nextCursor ||
            isLoadingMoreRef.current
        ) return;

        isLoadingMoreRef.current = true;

        try {
            const token = await getAccessTokenSilently();
            const response = await fetch(
                `${process.env.NEXT_PUBLIC_API_URL}/api/v1/conversations/${conversationId}/messages?before=${nextCursor}&limit=50`,
                { headers: { Authorization: `Bearer ${token}` } },
            );

            if (!response.ok) {
                throw new Error(await readApiError(response, "Failed to load older messages"));
            }

            const payload = await response.json() as { data: MessageHistoryPage };
            const batch = payload.data.messages;
            const nextIndex = firstItemIndexRef.current - batch.length;
            firstItemIndexRef.current = nextIndex;
            setFirstItemIndex(nextIndex);
            setMessageList((current) => [...batch, ...current]);
            setNextCursor(payload.data.nextCursor);
            setHasMore(payload.data.hasMore);
        } catch (error) {
            console.error(error);
        } finally {
            isLoadingMoreRef.current = false;
        }
    }, [conversationId, getAccessTokenSilently, hasMore, isInitialLoaded, nextCursor]);

    const itemContent = useCallback((index: number, msg: ChatMessage) => {
        const arrayIndex = index - firstItemIndexRef.current;
        const prevMsg = arrayIndex > 0 ? messageListRef.current[arrayIndex - 1] : null;
        const isAssistant = msg.sender === "assistant";
        const showDivider = !prevMsg || getBKK(getSafeDate(msg.createdAt)) !== getBKK(getSafeDate(prevMsg.createdAt));

        return (
            <div className="flex flex-col w-full">
                {showDivider && (
                    <div className="w-full flex justify-center py-6">
                        <div className="flex items-center gap-4 w-full">
                            <div className="h-[2px] flex-1 bg-gradient-to-r from-transparent to-[60%] to-[var(--border)]" />
                            <span className="text-[10px] text-[var(--amber)] uppercase tracking-widest font-[family-name:var(--font-body)]">
                                {formatDateDivider(msg.createdAt)}
                            </span>
                            <div className="h-[2px] flex-1 bg-gradient-to-l from-transparent to-[60%] to-[var(--border)]" />
                        </div>
                    </div>
                )}
                <div className={`flex w-full gap-3 px-6 py-3 ${isAssistant ? "flex-row items-end" : "flex-row-reverse items-end"}`}>
                    <div className={`shrink-0 w-7 h-7 rounded-full border-[1px] border-[var(--border2)] flex items-center justify-center text-[11px] font-[family-name:var(--font-display)] mb-0.5 ${isAssistant ? "bg-gradient-to-br from-[#2A1F14] to-[#3D2A18] text-[var(--amber)]" : "bg-[var(--surface2)] text-[var(--text-secondary)]"}`}>
                        {isAssistant ? "C" : "I"}
                    </div>
                    <div className={`flex flex-col max-w-[68%] gap-1 ${isAssistant ? "items-start" : "items-end"}`}>
                        <div className={`flex items-center gap-2 px-1 ${isAssistant ? "flex-row" : "flex-row-reverse"}`}>
                            {isAssistant && <span className="font-[family-name:var(--font-display)] italic text-[var(--amber)] text-[11px] tracking-wide">Cantarella</span>}
                            <span className="inline-flex items-center gap-1 text-[var(--text-dim)] font-light text-[10px]">
                                {formatMessageTime(msg.createdAt)}
                                {!isAssistant && <MessageStatus status={msg.status} />}
                            </span>
                        </div>
                        <div className={`relative px-4 py-3 text-[14px] leading-[1.65] font-light tracking-wide border-[1px] border-[var(--border)] shadow-sm ${isAssistant ? "bg-[var(--surface)] text-[var(--text)] rounded-2xl rounded-bl-sm" : "bg-[var(--surface2)] text-[var(--text)] rounded-2xl rounded-br-sm"}`}>
                            {isAssistant && <div className="absolute inset-0 pointer-events-none rounded-2xl bg-gradient-to-br from-[rgba(201,147,90,0.04)] to-transparent" />}
                            <p className="relative z-10">{msg.content}</p>
                        </div>
                        {!isAssistant && msg.status === "failed" && (
                            <span className="px-1 text-[10px] tracking-wide text-red-400">
                                Cantarella couldn&apos;t respond
                            </span>
                        )}
                    </div>
                </div>
            </div>
        );
    }, []);

    const handleSend = async () => {
        const userContent = message.trim();
        if (!userContent || !conversationId) return;

        const clientMessageId = crypto.randomUUID();
        setMessage("");
        const userMsg: ChatMessage = {
            id: `pending-${clientMessageId}`,
            turnId: null,
            clientMessageId,
            content: userContent,
            sender: "user",
            createdAt: new Date().toISOString(),
            source: "web",
            messageKind: "chat",
            partIndex: null,
            status: "sending",
        };
        setMessageList((prev) => [...prev, userMsg]);

        try {
            const token = await getAccessTokenSilently();
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/conversations/${conversationId}/messages`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                    clientMessageId,
                    content: userContent,
                    source: "web",
                    replyToMessageId: null,
                }),
            });

            if (!res.ok) {
                throw new Error(await readApiError(res, "Failed to send message"));
            }

            const payload = await res.json() as { data: { message: ChatMessage } };
            const savedMessage = payload.data.message;
            const resolvedMessage =
                savedMessage.turnId && failedTurnIdsRef.current.has(savedMessage.turnId)
                    ? { ...savedMessage, status: "failed" as const }
                    : savedMessage.turnId && seenTurnIdsRef.current.has(savedMessage.turnId)
                        ? { ...savedMessage, status: "seen" as const }
                        : savedMessage;
            setMessageList((current) => current.map((item) =>
                item.clientMessageId === clientMessageId ? resolvedMessage : item
            ));
        } catch (e) {
            console.error(e);
            setMessageList((prev) => prev.filter((msg) => msg.id !== userMsg.id));
            setMessage((current) => current || userContent);
        }
    };

    return (
        <div className="grid h-dvh w-full grid-cols-[260px_1fr] overflow-hidden bg-[var(--bg)] max-[820px]:grid-cols-[76px_1fr]">
            <Navbar />
            <main className="main-window flex min-h-0 min-w-0 flex-col overflow-hidden">
                <div className="relative z-20 flex shrink-0 chat-header w-full px-[28px] py-[18px] border-b-[1px] border-[var(--border)] bg-[rgba(12,10,9,0.8)] backdrop-blur-md">
                    <div className="flex flex-col">
                        <span className="font-[family-name:var(--font-display)] text-[clamp(10px,3vw,20px)] tracking-wider text-[var(--text)] font-light">
                            Talking to <span className="text-[var(--amber)] italic">Cantarella</span>
                        </span>
                        <span className="font-[font-family:var(--font-body)] text-[var(--text-dim)] tracking-wider mt-[1px] text-[clamp(5.5px,3vw,11px)]">she remembers everything</span>
                    </div>
                </div>

                <div className={`min-h-0 w-full flex-1 overflow-hidden transition-opacity duration-500 ${isInitialLoaded ? "opacity-100" : "opacity-0"}`}>
                    <Virtuoso
                        ref={virtuoso}
                        style={{ height: "100%" }}
                        data={messageList}
                        firstItemIndex={firstItemIndex}
                        initialTopMostItemIndex={messageList.length > 0 ? messageList.length - 1 : 0}
                        startReached={loadMore}
                        followOutput={(isAtBottom) => isAtBottom ? "smooth" : false}
                        atBottomThreshold={80}
                        atBottomStateChange={(isAtBottom) => {
                            isAtBottomRef.current = isAtBottom;
                        }}
                        increaseViewportBy={{ top: 400, bottom: 600 }}
                        itemContent={itemContent}
                        components={{
                            Footer: () => isTyping ? (
                                <div className="flex w-full items-end gap-3 px-6 py-3 pb-4">
                                    <div className="shrink-0 w-7 h-7 rounded-full border-[1px] border-[var(--border2)] flex items-center justify-center text-[11px] font-[family-name:var(--font-display)] bg-gradient-to-br from-[#2A1F14] to-[#3D2A18] text-[var(--amber)] mb-0.5">C</div>
                                    <div className="bg-[var(--surface)] border-[var(--border)] border-[1px] rounded-2xl rounded-bl-sm px-4 py-[14px] flex gap-1.5 items-center">
                                        <div className="w-[5px] h-[5px] bg-[var(--amber)] rounded-full animate-typing-1" />
                                        <div className="w-[5px] h-[5px] bg-[var(--amber)] rounded-full animate-typing-2" />
                                        <div className="w-[5px] h-[5px] bg-[var(--amber)] rounded-full animate-typing-3" />
                                    </div>
                                </div>
                            ) : <div className="h-4" />
                        }}
                    />
                </div>

                <div className="flex w-full shrink-0 bg-linear-to-r from-[var(--surface3)]/15 to-transparent px-[2.5%] py-3">
                    <div className="mx-auto flex w-full flex-col items-center justify-center space-y-2 font-[font-family:var(--font-body)]">
                        {showPeakPricingAlert && (
                            <div
                                className="group relative flex w-full cursor-help items-center gap-2 rounded-lg border border-[rgba(201,147,90,0.24)] bg-[var(--amber-dim)] px-3 py-2 text-[10px] text-[var(--amber-soft)]"
                            >
                                <CircleAlert className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
                                <span>
                                    {isPeakTime
                                        ? `DeepSeek peak pricing is active — 2× until ${peakEndsAt ? formatLocalTime(peakEndsAt, userTimeZone) : "the window ends"}`
                                        : "DeepSeek peak pricing is not active right now"}
                                    <span className="ml-1.5 text-[var(--text-secondary)]">{formatLocalPeakSchedule(userTimeZone)}</span>
                                </span>
                                <span
                                    role="tooltip"
                                    className="pointer-events-none absolute bottom-[calc(100%+8px)] left-0 z-40 w-[min(360px,calc(100vw-40px))] rounded-lg border border-[var(--border2)] bg-[var(--surface2)] px-3 py-2.5 text-[10px] leading-4 text-[var(--text-secondary)] opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100"
                                >
                                    Peak pricing means DeepSeek charges 2× during its busiest weekday windows. Cantarella works exactly the same; only the Thought-model price changes. These times are shown in your local timezone.
                                </span>
                            </div>
                        )}
                        <div className="flex min-h-12 w-full items-end rounded-xl border-[1px] border-[var(--border2)] bg-[var(--surface)] px-3 py-2 transition-all focus-within:border-[rgba(201,147,90,0.35)] focus-within:shadow-[0_0px_3px_rgba(201,147,90,0.05)]">
                            <textarea
                                ref={messageInputRef}
                                autoFocus
                                rows={1}
                                placeholder="What's on your mind?"
                                onChange={(e) => setMessage(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key !== "Enter") return;
                                    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
                                    e.preventDefault();
                                    handleSend();
                                }}
                                value={message}
                                className="max-h-36 min-h-7 flex-1 resize-none bg-transparent px-2 py-1 text-[var(--text)] text-[clamp(7px,3vw,14px)] placeholder:italic placeholder:text-[var(--text-dim)] focus:outline-none"
                            />
                            <button disabled={!conversationId || !message.trim()} onClick={handleSend} className="send-box p-2 bg-[var(--amber)] rounded-lg text-[#1A0F08] hover:text-[var(--amber)] transition-colors items-center justify-center flex disabled:opacity-50 disabled:cursor-not-allowed">
                                <Send className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="helper-text text-[var(--text-dim)] text-[clamp(5px,3vw,10px)] font-medium w-full justify-start item-center">
                            <span className="bg-[var(--surface2)] text-[var(--text-secondary)] mr-1 px-1 py-0.5 border-[1px] border-[var(--border)] rounded-sm">Enter</span> to send · <span className="ml-1 bg-[var(--surface2)] text-[var(--text-secondary)] px-1 py-0.5 border-[1px] border-[var(--border)] rounded-sm">⌘/Ctrl + Enter</span> for a new line
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
