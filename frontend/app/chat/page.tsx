"use client";
import { useAuth0 } from "@auth0/auth0-react";
import Navbar from "../navbar";
import { useEffect, useState, useRef, useCallback } from "react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import { Send } from "lucide-react";

export default function Page() {
    const { getAccessTokenSilently, isAuthenticated } = useAuth0();
    const [message, setMessage] = useState("");
    const [messageList, setMessageList] = useState<any[]>([]);
    const [isTyping, setIsTyping] = useState(false);
    const [isInitialLoaded, setIsInitialLoaded] = useState(false);
    const [cursorId, setCursorId] = useState<any>(Infinity);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const START_INDEX = 100000;
    const [firstItemIndex, setFirstItemIndex] = useState(START_INDEX);
    const firstItemIndexRef = useRef(START_INDEX);
    const virtuoso = useRef<VirtuosoHandle>(null);
    const messageListRef = useRef<any[]>([]);
    messageListRef.current = messageList;

    const getSafeDate = (timeStr: string) => {
        if (!timeStr) return new Date();
        if (typeof timeStr !== "string") return new Date(timeStr);
        let s = timeStr.trim();
        if (s.includes(" ")) s = s.replace(" ", "T");
        if (!s.endsWith("Z")) s += "Z";
        return new Date(s);
    };

    const getBKK = (date: Date) =>
        date.toLocaleDateString("en-US", { timeZone: "Asia/Bangkok" });

    const formatDateDivider = (timeStr: string) => {
        const d = getSafeDate(timeStr);
        const now = new Date();
        if (getBKK(d) === getBKK(now)) return "Today";
        if (getBKK(d) === getBKK(new Date(now.getTime() - 86400000))) return "Yesterday";
        return d.toLocaleDateString("en-US", { timeZone: "Asia/Bangkok", weekday: "long", month: "short", day: "numeric" });
    };

    const formatMessageTime = (timeStr: string) => {
        if (!timeStr) return "";
        return getSafeDate(timeStr).toLocaleTimeString("en-US", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" });
    };

    useEffect(() => {
        if (!isAuthenticated) return;

        const run = async () => {
            if (isLoadingMore) return;
            setIsLoadingMore(true);
            try {
                const token = await getAccessTokenSilently();
                const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/message/history?cursorId=${cursorId}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const data = await res.json();
                const batch = [...data.history].reverse();

                if (cursorId === Infinity) {
                    setMessageList(batch);
                    setFirstItemIndex(START_INDEX);
                    firstItemIndexRef.current = START_INDEX;
                    setTimeout(() => {
                        setIsInitialLoaded(true);
                        virtuoso.current?.scrollToIndex({ index: batch.length - 1, align: "end" });
                    }, 50);
                } else {
                    const next = firstItemIndexRef.current - batch.length;
                    firstItemIndexRef.current = next;
                    setFirstItemIndex(next);
                    setMessageList((prev) => [...batch, ...prev]);
                }
            } catch (e) {
                console.error(e);
            } finally {
                setIsLoadingMore(false);
            }
        };

        run();
    }, [isAuthenticated, cursorId]);

    const loadMore = useCallback(() => {
        if (isLoadingMore || messageListRef.current.length === 0) return;
        setCursorId(messageListRef.current[0].createdAt);
    }, [isLoadingMore]);

    const itemContent = useCallback((index: number, msg: any) => {
        const arrayIndex = index - firstItemIndexRef.current;
        const prevMsg = arrayIndex > 0 ? messageListRef.current[arrayIndex - 1] : null;
        const isAssistant = msg.role === "assistant";
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
                        <div className={`flex items-baseline gap-2 px-1 ${isAssistant ? "flex-row" : "flex-row-reverse"}`}>
                            {isAssistant && <span className="font-[family-name:var(--font-display)] italic text-[var(--amber)] text-[11px] tracking-wide">Cantarella</span>}
                            <span className="text-[var(--text-dim)] font-light text-[10px]">{formatMessageTime(msg.createdAt)}</span>
                        </div>
                        <div className={`relative px-4 py-3 text-[14px] leading-[1.65] font-light tracking-wide border-[1px] border-[var(--border)] shadow-sm ${isAssistant ? "bg-[var(--surface)] text-[var(--text)] rounded-2xl rounded-bl-sm" : "bg-[var(--surface2)] text-[var(--text)] rounded-2xl rounded-br-sm"}`}>
                            {isAssistant && <div className="absolute inset-0 pointer-events-none rounded-2xl bg-gradient-to-br from-[rgba(201,147,90,0.04)] to-transparent" />}
                            <p className="relative z-10">{msg.content}</p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }, []);

    const handleSend = async () => {
        if (!message.trim()) return;
        const userContent = message;
        setMessage("");
        const userMsg = { id: Date.now(), content: userContent, role: "user", createdAt: new Date().toISOString() };
        setMessageList((prev) => [...prev, userMsg]);
        setIsTyping(true);
        try {
            const token = await getAccessTokenSilently();
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/message/send`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ content: userContent, platform: "web" }),
            });
            const data = await res.json();
            setMessageList((prev) => [...prev, { id: Date.now() + 1, content: data.response, role: "assistant", createdAt: new Date().toISOString() }]);
        } catch (e) {
            console.error(e);
        } finally {
            setIsTyping(false);
        }
    };

    return (
        <div className="w-full h-screen bg-[var(--bg)] grid grid-cols-[260px_1fr]">
            <Navbar status={true} />
            <div className="main-window w-full h-full flex flex-col">
                <div className="relative z-20 flex shrink-0 chat-header w-full px-[28px] py-[18px] border-b-[1px] border-[var(--border)] bg-[rgba(12,10,9,0.8)] backdrop-blur-md">
                    <div className="flex flex-col">
                        <span className="font-[family-name:var(--font-display)] text-[clamp(10px,3vw,20px)] tracking-wider text-[var(--text)] font-light">
                            Talking to <span className="text-[var(--amber)] italic">Cantarella</span>
                        </span>
                        <span className="font-[font-family:var(--font-body)] text-[var(--text-dim)] tracking-wider mt-[1px] text-[clamp(5.5px,3vw,11px)]">she remembers everything</span>
                    </div>
                </div>

                <div className={`w-full flex-col flex-1 transition-opacity duration-500 ${isInitialLoaded ? "opacity-100" : "opacity-0"}`}>
                    <Virtuoso
                        ref={virtuoso}
                        style={{ height: "100%" }}
                        data={messageList}
                        firstItemIndex={firstItemIndex}
                        initialTopMostItemIndex={messageList.length > 0 ? messageList.length - 1 : 0}
                        startReached={loadMore}
                        followOutput={(isAtBottom) => isAtBottom ? "smooth" : false}
                        increaseViewportBy={{ top: 999999, bottom: 999999 }}
                        itemContent={itemContent}
                        components={{
                            Footer: () => isTyping ? (
                                <div className="flex w-full gap-3 px-6 py-3 items-end">
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

                <div className="w-full h-[13%] bg-linear-to-r from-[var(--surface3)]/15 to-transparent mt-auto flex">
                    <div className="w-[95%] h-full flex flex-col items-center justify-center mx-auto space-y-2 font-[font-family:var(--font-body)]">
                        <div className="w-full h-[50%] flex items-center bg-[var(--surface)] border-[var(--border2)] border-[1px] rounded-xl px-3 focus-within:border-[rgba(201,147,90,0.35)] focus-within:shadow-[0_0px_3px_rgba(201,147,90,0.05)] transition-all">
                            <input
                                autoFocus
                                placeholder="What's on your mind?"
                                onChange={(e) => setMessage(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                                value={message}
                                className="flex-1 h-full bg-transparent text-[var(--text)] text-[clamp(7px,3vw,14px)] placeholder:text-[var(--text-dim)] placeholder:italic px-2 focus:outline-none"
                            />
                            <button onClick={handleSend} className="send-box p-2 bg-[var(--amber)] rounded-lg text-[#1A0F08] hover:text-[var(--amber)] transition-colors items-center justify-center flex">
                                <Send className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="helper-text text-[var(--text-dim)] text-[clamp(5px,3vw,10px)] font-medium w-full justify-start item-center">
                            <span className="bg-[var(--surface2)] text-[var(--text-secondary)] mr-1 px-1 py-0.5 border-[1px] border-[var(--border)] rounded-sm">Enter</span> to send ·{" "}
                            <span className="bg-[var(--surface2)] text-[var(--text-secondary)] mr-1 px-1 py-0.5 border-[1px] border-[var(--border)] rounded-sm">Shift Enter</span> for new line
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}