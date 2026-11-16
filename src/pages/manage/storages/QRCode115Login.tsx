import {
  Box,
  Button,
  Center,
  Image,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Text,
  VStack,
} from "@hope-ui/solid"
import { createSignal, onCleanup, Show } from "solid-js"
import { useT } from "~/hooks"
import { notify, r } from "~/utils"
import type { Resp } from "~/types"

interface StartResult {
  session: string
  image: string
}

interface StatusResult {
  status: number
  cookie?: string
}

export const QRCode115Login = (props: {
  source: string
  driver: string
  onCookie: (cookie: string) => void
}) => {
  const t = useT()
  const [opened, setOpened] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [image, setImage] = createSignal("")
  const [message, setMessage] = createSignal("")
  let timer: ReturnType<typeof setTimeout> | undefined
  let generation = 0

  const stop = () => {
    generation++
    if (timer) clearTimeout(timer)
    timer = undefined
  }
  const close = () => {
    stop()
    setOpened(false)
    setLoading(false)
  }
  onCleanup(stop)

  const poll = async (session: string, current: number) => {
    try {
      const resp: Resp<StatusResult> = await r.post(
        "/admin/driver/115/qrcode/status",
        { session },
      )
      if (current !== generation) return
      if (resp.code !== 200) {
        setMessage(resp.message)
        return
      }
      switch (resp.data.status) {
        case 0:
          setMessage(t("storages.qrcode_115.waiting"))
          break
        case 1:
          setMessage(t("storages.qrcode_115.scanned"))
          break
        case 2:
          if (!resp.data.cookie) {
            setMessage(t("storages.qrcode_115.failed"))
            return
          }
          props.onCookie(resp.data.cookie)
          notify.success(t("storages.qrcode_115.success"))
          close()
          return
        case -1:
          setMessage(t("storages.qrcode_115.expired"))
          return
        case -2:
          setMessage(t("storages.qrcode_115.canceled"))
          return
        default:
          setMessage(t("storages.qrcode_115.failed"))
          return
      }
      timer = setTimeout(() => void poll(session, current), 2000)
    } catch {
      if (current === generation) setMessage(t("storages.qrcode_115.failed"))
    }
  }

  const start = async () => {
    stop()
    const current = generation
    setOpened(true)
    setLoading(true)
    setImage("")
    setMessage(t("storages.qrcode_115.loading"))
    try {
      const resp: Resp<StartResult> = await r.post(
        "/admin/driver/115/qrcode/start",
        { source: props.source || "web" },
      )
      if (current !== generation) return
      if (resp.code !== 200 || !resp.data?.session || !resp.data?.image) {
        setMessage(resp.message || t("storages.qrcode_115.failed"))
        return
      }
      setImage(resp.data.image)
      setMessage(t("storages.qrcode_115.waiting"))
      timer = setTimeout(() => void poll(resp.data.session, current), 2000)
    } catch {
      if (current === generation) setMessage(t("storages.qrcode_115.failed"))
    } finally {
      if (current === generation) setLoading(false)
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
        {t("storages.qrcode_115.action")}
      </Button>
      <Modal opened={opened()} onClose={close}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>{t("storages.qrcode_115.title")}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack w="$full" spacing="$3">
              <Show when={image()}>
                <Center>
                  <Box bg="white" p="$2" rounded="$md">
                    <Image
                      src={image()}
                      alt={t("storages.qrcode_115.title")}
                      w="256px"
                      h="256px"
                      style={{ "image-rendering": "pixelated" }}
                    />
                  </Box>
                </Center>
              </Show>
              <Text fontSize="$sm">
                {t("storages.qrcode_115.source")}:{" "}
                {t(
                  "drivers." + props.driver + ".qrcode_sources." + props.source,
                )}
              </Text>
              <Text>{message()}</Text>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={close}>
              {t("global.cancel")}
            </Button>
            <Button
              colorScheme="primary"
              loading={loading()}
              onClick={() => void start()}
            >
              {t("storages.qrcode_115.refresh")}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
