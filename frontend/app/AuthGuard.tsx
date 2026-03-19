"use client";

import { useAuth0 } from "@auth0/auth0-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

export default function AuthGuard({children} : {children : React.ReactNode}){

    const { isAuthenticated, isLoading } = useAuth0();

    const router = useRouter();
    const pathname = usePathname();

    const publicRoute = ['/auth/login'];

    useEffect(()=>{
        if(!isLoading && !isAuthenticated && !publicRoute.includes(pathname)){
            router.push(publicRoute[0]);
        }
    }, [isAuthenticated, isLoading, pathname]);

    if(isLoading) return null;
    if (!isAuthenticated && !publicRoute.includes(pathname)) return null;

    return <>{children}</>;
}