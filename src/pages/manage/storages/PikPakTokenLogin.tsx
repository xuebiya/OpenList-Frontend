import {
  Button,
  Center,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Spinner,
  Text,
  VStack,
} from "@hope-ui/solid"
import { createSignal, onCleanup, Show } from "solid-js"
import type { Accessor } from "solid-js"
import { useT } from "~/hooks"
import { api, notify } from "~/utils"
import type { Resp } from "~/types"

export interface PikPakLoginToken {
  refresh_token: string
  platform: string
  device_id: string
}
interface LoginView extends Partial<PikPakLoginToken> {
  state: "waiting" | "complete"
}

// These responses carry credentials. Use fetch so the shared axios response
// logger never prints the refresh token to the browser console.
async function loginRequest<T>(action: string, body: object): Promise<T> {
  const response = await fetch(
    api + "/api/admin/driver/pikpak/login/" + action,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: localStorage.getItem("token") || "",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "omit",
      keepalive: action === "close",
    },
  )
  const result: Resp<T> = await response.json()
  if (result.code !== 200) throw new Error(result.message)
  return result.data
}

export const PikPakTokenLogin = (props: {
  username: Accessor<string>
  onToken: (token: PikPakLoginToken) => void
}) => {
  const t = useT()
  const [opened, setOpened] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal("")
  const [authorizationURL, setAuthorizationURL] = createSignal("")
  let session = "",
    generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let popup: Window | null = null

  const message = (err: unknown) => {
    const raw = err instanceof Error ? err.message : ""
    const key = raw.startsWith("pikpak_login.") ? raw.slice(13) : "failed"
    return t(
      "storages.pikpak_login.errors." + key,
      undefined,
      t("storages.pikpak_login.errors.failed"),
    )
  }
  const release = (id: string) => {
    if (id) void loginRequest("close", { session: id }).catch(() => {})
  }
  const stop = () => {
    generation++
    if (timer) clearTimeout(timer)
    timer = undefined
    release(session)
    session = ""
    if (popup && !popup.closed) popup.close()
    popup = null
  }
  const close = () => {
    stop()
    setOpened(false)
    setLoading(false)
  }
  onCleanup(stop)

  const poll = async (current: number) => {
    try {
      const view = await loginRequest<LoginView>("view", { session })
      if (current !== generation) return
      if (
        view.state === "complete" &&
        view.refresh_token &&
        view.device_id &&
        view.platform
      ) {
        props.onToken(view as PikPakLoginToken)
        notify.success(t("storages.pikpak_login.success"))
        close()
        return
      }
      setLoading(false)
      timer = setTimeout(() => void poll(current), 700)
    } catch (err) {
      if (current !== generation) return
      setError(message(err))
      setLoading(false)
      stop()
    }
  }
  const openPopup = (url = "about:blank") => {
    const width = 600,
      height = 720
    const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2)
    const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2)
    const openedPopup = window.open(
      "about:blank",
      "_blank",
      "popup=yes,width=" +
        width +
        ",height=" +
        height +
        ",left=" +
        left +
        ",top=" +
        top,
    )
    if (openedPopup) {
      openedPopup.opener = null
      if (url !== "about:blank") openedPopup.location.replace(url)
    }
    return openedPopup
  }
  const start = async () => {
    const username = props.username().trim()
    if (!username.includes("@")) {
      notify.error(t("storages.pikpak_login.errors.email_required"))
      return
    }
    stop()
    setAuthorizationURL("")
    popup = openPopup()
    const current = generation
    setOpened(true)
    setLoading(true)
    setError("")
    try {
      const result = await loginRequest<{
        session: string
        authorization_url?: string
      }>("start", { username, mode: "device" })
      if (current !== generation) {
        release(result.session)
        return
      }
      session = result.session
      const url = new URL(result.authorization_url || "")
      if (
        url.protocol !== "https:" ||
        !["mypikpak.com", "www.mypikpak.com"].includes(url.hostname) ||
        url.pathname !== "/drive/qr-login" ||
        url.username ||
        url.password ||
        (url.port && url.port !== "443")
      ) {
        throw new Error("pikpak_login.unexpected_origin")
      }
      setAuthorizationURL(url.href)
      if (popup && !popup.closed) popup.location.replace(url.href)
      await poll(current)
    } catch (err) {
      if (current !== generation) return
      setError(message(err))
      setLoading(false)
      stop()
    }
  }
  return (
    <>
      <Button
        mt="$2"
        size="sm"
        colorScheme="primary"
        variant="outline"
        onClick={() => void start()}
      >
        {t("storages.pikpak_login.action")}
      </Button>
      <Modal
        opened={opened()}
        onClose={close}
        closeOnOverlayClick={false}
        size="lg"
        centered
        scrollBehavior="inside"
      >
        <ModalOverlay />
        <ModalContent maxW="560px" maxH="calc(100dvh - 32px)">
          <ModalHeader>{t("storages.pikpak_login.title")}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack spacing="$3" w="$full">
              <Show when={loading()}>
                <Center minH="200px">
                  <Spinner />
                </Center>
              </Show>
              <Show when={authorizationURL() && !error()}>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (popup && !popup.closed) popup.focus()
                    else popup = openPopup(authorizationURL())
                  }}
                >
                  {t("storages.pikpak_login.open_authorization")}
                </Button>
              </Show>
              <Text
                fontSize="$sm"
                color={error() ? "$danger10" : "$neutral11"}
                textAlign="center"
                role="status"
              >
                {error() ||
                  t(
                    loading()
                      ? "storages.pikpak_login.device_loading"
                      : "storages.pikpak_login.device_waiting",
                  )}
              </Text>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={close}>
              {t("global.cancel")}
            </Button>
            <Show when={error()}>
              <Button onClick={() => void start()}>
                {t("storages.pikpak_login.retry")}
              </Button>
            </Show>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
