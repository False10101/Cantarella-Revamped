"use client";
import { useAuth0 } from "@auth0/auth0-react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
    const { loginWithRedirect, isAuthenticated, isLoading } = useAuth0();
    const router = useRouter();

    useEffect(() => {
        if (isAuthenticated) router.push("/");
    }, [isAuthenticated]);

    if (isLoading) return null;

    return (
        <div className="bg-[var(--bg)] h-screen w-full relative">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 pointer-events-none"
                style={{
                    width: '80vw',
                    height: '50vh',
                    background: 'radial-gradient(ellipse at 50% 0%, rgba(201,147,90,0.12) 0%, transparent 70%)'
                }}
            ></div>
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 pointer-events-none"
                style={{
                    width: '60vw',
                    height: '40vh',
                    background: 'radial-gradient(ellipse at 50% 100%, rgba(201,147,90,0.08) 0%, transparent 70%)'
                }}
            ></div>

            <div className="main-content relative w-full h-full flex flex-col items-center justify-center">
                <div className="flex animate-fadeup delay-1 w-full justify-center items-center space-x-4 mb-5">
                    <div className="left-line w-[40px] h-[1px] lg:w-[60px] lg:h-[1.25px] bg-linear-to-l from-[var(--amber)] to-transparent"></div>
                    <div className="middle-dot w-[4px] h-[4px] lg:w-[5px] lg:h-[5px] rounded-full opacity-60 bg-[var(--amber)]"></div>
                    <div className="left-line w-[40px] h-[1px] lg:w-[60px] lg:h-[1.25px] bg-linear-to-r from-[var(--amber)] to-transparent"></div>
                </div>
                <div className="title animate-fadeup delay-2 w-full flex justify-center items-center font-[family-name:var(--font-display)] italic tracking-wider leading-none text-[clamp(36px,6vw,72px)]">
                    <span className="text-[var(--text)]">Canta</span>
                    <span className="text-[var(--amber)]">rella</span>
                </div>
                <div className="subtitle animate-fadeup delay-3 w-full mt-2 flex justify-center items-center font-[family-name:var(--font-display)] uppercase text-[var(--text-secondary)] tracking-wide font-light text-[clamp(10px,3vw,20px)]">
                    she's been waiting
                </div>
                <div className="description animate-fadeup delay-4 w-full mt-2 flex justify-center items-center font-[family-name:var(--font-display)] text-[var(--text-dim)] tracking-[0.04em] font-light text-[clamp(9.5px,2vw,19px)] italic">
                    your personal AI assistant who actually knows you
                </div>
                <div className="vertical-divider animate-fadeup delay-4 my-9 flex justify-center items-center w-[1px] h-[40px] lg:w-[1.5px] lg:h-[60px] bg-gradient-to-b from-[var(--border2)] to-transparent"></div>

                {
                    !isLoading &&
                    <button  onClick={() => loginWithRedirect({ authorizationParams: { connection: 'google-oauth2' } })} className="bg-transparent animate-fadeup delay-5 group flex items-center justify-center space-x-3 border-[1.5px] border-[var(--border2)] rounded-[12px] px-[23px] py-[11px] font-[family-name:var(--font-body)] text-[clamp(8px,2vw,16px)] font-medium hover:bg-[var(--amber-dim)] hover:border-[rgba(201,147,90,0.4)] hover:-translate-y-[1px] hover:shadow-[0_8px_32px_rgba(201,147,90,0.08)] transition-all duration-300 cursor-pointer">
                        <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                        </svg>
                        <span className="text-white">Continue with Google</span>
                        <span className="text-[var(--amber)] font-bold transition-transform duration-300 group-hover:translate-x-[3px]">→</span>
                    </button>
                }
            </div>
        </div>
    )
}