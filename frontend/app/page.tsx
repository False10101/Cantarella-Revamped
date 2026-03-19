"use client"
import { useAuth0 } from "@auth0/auth0-react";
import { useRouter } from "next/navigation";


export default function Home() {

  const { getAccessTokenSilently, logout } = useAuth0();
  const router = useRouter();

  // useEffect(() => {
  //   const getToken = async () => {
  //     const token = await getAccessTokenSilently()
  //     console.log("token :" + token)
  //   }
  //   getToken()
  // }, [])


  return router.push("/chat");
}
