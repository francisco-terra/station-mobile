import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import _ from 'lodash'
import { AppState, BackHandler, ToastAndroid, Linking } from 'react-native'
import { WebView } from 'react-native-webview'
import { getVersion } from 'react-native-device-info'
import { useRecoilValue, useSetRecoilState } from 'recoil'
import WalletConnect from '@walletconnect/client'
import {
  authenticateBiometric,
  isSupportedBiometricAuthentication,
} from 'utils/bio'
import useWalletConnect from 'hooks/useWalletConnect'
import AppStore from 'stores/AppStore'
import { User } from 'lib/types'
import WalletConnectStore from 'stores/WalletConnectStore'
import TransportBLE from '@ledgerhq/react-native-hw-transport-ble'
import { LedgerKey } from '@terra-money/ledger-terra-js'
import {
  LCDClient,
  Wallet,
  CreateTxOptions,
  Fee,
  Msg,
} from '@terra-money/terra.js'
import { settings } from 'utils/storage'
import { SignMode } from '@terra-money/terra.proto/cosmos/tx/signing/v1beta1/signing'
import { useConfig, useIsClassic } from 'lib'
import useNetworks from 'hooks/useNetworks'

export const RN_APIS = {
  APP_VERSION: 'APP_VERSION',
  MIGRATE_KEYSTORE: 'MIGRATE_KEYSTORE',
  SET_NETWORK: 'SET_NETWORK',
  SET_THEME: 'SET_THEME',
  CHECK_BIO: 'CHECK_BIO',
  AUTH_BIO: 'AUTH_BIO',
  DEEPLINK: 'DEEPLINK',
  QR_SCAN: 'QR_SCAN',
  RECOVER_SESSIONS: 'RECOVER_SESSIONS',
  DISCONNECT_SESSIONS: 'DISCONNECT_SESSIONS',
  READY_CONNECT_WALLET: 'READY_CONNECT_WALLET',
  CONNECT_WALLET: 'CONNECT_WALLET',
  REJECT_SESSION: 'REJECT_SESSION',
  CONFIRM_TX: 'CONFIRM_TX',
  APPROVE_TX: 'APPROVE_TX',
  REJECT_TX: 'REJECT_TX',
  GET_LEDGER_LIST: 'GET_LEDGER_LIST',
  GET_LEDGER_KEY: 'GET_LEDGER_KEY',
}

interface DeviceInterface {
  name: string
  id: string
}

const uri = 'https://mobile.station.terra.money'

export const WebViewContainer = ({
  user,
  setIsVisibleModal,
}: {
  user?: User[]
  setIsVisibleModal?: any
}) => {
  const appState = useRef<string>(AppState.currentState)
  const { chain, theme } = useConfig()
  const { networks } = useNetworks()
  const isClassic = useIsClassic()

  const {
    newWalletConnect,
    recoverWalletConnect,
    removeWalletConnect,
    saveWalletConnector,
    disconnectWalletConnect,
    disconnectAllWalletConnect,
  } = useWalletConnect()
  const webviewInstance = useRecoilValue(AppStore.webviewInstance)
  const walletConnectors = useRecoilValue(
    WalletConnectStore.walletConnectors
  )
  const setWebviewLoadEnd = useSetRecoilState(AppStore.webviewLoadEnd)

  const [localWalletConnector, setLocalWalletConnector] =
    useState<WalletConnect | null>(null)

  const [canGoBack, SetCanGoBack] = useState(false)
  const [, setScanning] = useState(false)
  const [, setError] = useState('')
  const [ledgers, setLedgers] = useState<DeviceInterface[]>([])
  const [ledgerReqId, setLedgerReqId] = useState<DeviceInterface[]>(
    []
  )

  let exitAppTimeout: NodeJS.Timeout | null = null
  let isExit = false

  interface TxResponse<T = any> {
    success: boolean
    result?: T
    error?: { code: number; message?: string }
  }
  interface DefaultRequest extends PrimitiveDefaultRequest {
    timestamp: Date
  }

  interface TxRequest extends DefaultRequest {
    tx: CreateTxOptions
    requestType: 'sign' | 'post'
  }

  interface PrimitiveDefaultRequest {
    id: number
    origin: string
  }

  interface PrimitiveTxRequest
    extends Partial<TxResponse>,
      PrimitiveDefaultRequest {
    msgs: string[]
    fee?: string
    memo?: string
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const requestAppVersion = async () => {
    try {
      const appVersion = `v${getVersion()}`
      return appVersion
    } catch (e) {
      console.log(e)
    }
  }

  const parseTx = (request: PrimitiveTxRequest): TxRequest['tx'] => {
    const { msgs, fee, memo } = request
    const isProto = '@type' in JSON.parse(msgs[0])
    return isProto
      ? {
          msgs: msgs.map((msg) => Msg.fromData(JSON.parse(msg), isClassic)),
          fee: fee ? Fee.fromData(JSON.parse(fee)) : undefined,
          memo,
        }
      : {
          msgs: msgs.map((msg) => Msg.fromAmino(JSON.parse(msg), isClassic)),
          fee: fee ? Fee.fromAmino(JSON.parse(fee)) : undefined,
          memo,
        }
  }

  const getCircularReplacer = () => {
    const seen = new WeakSet()

    return (key: any, value: object | null) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return
        }
        seen.add(value)
      }
      if (typeof value === 'function') {
        return `(${value})`
      }
      return value
    }
  }

  const WebViewListener = useCallback(
    async (req) => {
      if (webviewInstance.current) {
        if (!req) {
          return
        }
        const { data, type, reqId } = req

        switch (type) {
          case RN_APIS.APP_VERSION: {
            // @ts-ignore
            const version = await requestAppVersion()
            // @ts-ignore
            webviewInstance.current?.postMessage(
              JSON.stringify({
                reqId,
                type,
                data: version,
              })
            )
            break
          }
          case RN_APIS.SET_THEME: {
            // @ts-ignore
            theme.set(data)
            settings.set({ theme: data })

            // @ts-ignore
            webviewInstance.current?.postMessage(
              JSON.stringify({
                reqId,
                type,
                data: true,
              })
            )
            break
          }
          case RN_APIS.SET_NETWORK: {
            // @ts-ignore
            const nextChain = networks?.[data]
            settings.set({ chain: nextChain })
            chain.set(nextChain)

            // @ts-ignore
            webviewInstance.current?.postMessage(
              JSON.stringify({
                reqId,
                type,
                data: true,
              })
            )
            break
          }

          case RN_APIS.RECOVER_SESSIONS: {
            recoverWalletConnect(data)
            // @ts-ignore
            webviewInstance.current?.postMessage(
              JSON.stringify({
                reqId,
                type,
                data: true,
              })
            )
            break
          }

          case RN_APIS.DISCONNECT_SESSIONS: {
            if (data) {
              disconnectWalletConnect(data)
            } else {
              disconnectAllWalletConnect()
            }
            // @ts-ignore
            webviewInstance.current?.postMessage(
              JSON.stringify({
                reqId,
                type,
                data: true,
              })
            )
            break
          }

          case RN_APIS.REJECT_SESSION: {
            localWalletConnector?.rejectSession()
            break
          }

          case RN_APIS.READY_CONNECT_WALLET: {
            await connect({
              uri: data?.uri,
              reqId,
              type,
            })
            break
          }

          case RN_APIS.CONNECT_WALLET: {
            confirmConnect({
              userAddress: data?.userAddress,
            })

            if (!localWalletConnector?.session.peerMeta) {
              // @ts-ignore
              webviewInstance.current?.postMessage(
                JSON.stringify({
                  reqId,
                  type,
                  data: 'Error: No peerMeta data',
                })
              )
              return
            }

            // @ts-ignore
            webviewInstance.current?.postMessage(
              JSON.stringify({
                reqId,
                type,
                data: localWalletConnector?.session,
              })
            )
            break
          }

          case RN_APIS.MIGRATE_KEYSTORE: {
            setWebviewLoadEnd(true)
            // @ts-ignore
            webviewInstance.current?.postMessage(
              JSON.stringify({
                reqId: req.reqId,
                type: type,
                data: user,
              })
            )
            break
          }

          case RN_APIS.CHECK_BIO: {
            const isSuccess =
              await isSupportedBiometricAuthentication()
            // @ts-ignore
            webviewInstance.current?.postMessage(
              JSON.stringify({
                reqId,
                type,
                data: isSuccess,
              })
            )
            break
          }

          case RN_APIS.AUTH_BIO: {
            const isSuccess = await authenticateBiometric()
            // @ts-ignore
            webviewInstance.current?.postMessage(
              JSON.stringify({
                reqId,
                type,
                data: isSuccess,
              })
            )
            break
          }

          case RN_APIS.QR_SCAN: {
            setIsVisibleModal(reqId)
            break
          }

          case RN_APIS.GET_LEDGER_LIST: {
            setLedgerReqId(reqId)
            searchLedger()
            break
          }

          case RN_APIS.GET_LEDGER_KEY: {
            try {
              const ledgerId = await TransportBLE.open(data.id)
              const key = await LedgerKey.create(
                ledgerId,
                parseInt(data.path)
              )

              if (!data.hasOwnProperty('txOptions')) {
                const json = JSON.stringify(
                  key,
                  getCircularReplacer()
                )
                // @ts-ignore
                webviewInstance.current?.postMessage(
                  JSON.stringify({
                    reqId,
                    type,
                    data: json,
                  })
                )
                return
              }

              const lcd = new LCDClient(data?.lcdConfigs)
              const wallet = new Wallet(lcd, key)
              const { account_number, sequence } =
                await wallet.accountNumberAndSequence()

              const unsignedTx = await lcd.tx.create(
                [
                  {
                    address: data.address,
                  },
                ],
                parseTx(data.txOptions)
              )

              const options = {
                chainID: data?.lcdConfigs.chainID,
                accountNumber: account_number,
                sequence,
                signMode: SignMode.SIGN_MODE_LEGACY_AMINO_JSON,
              }

              const signed = await key.signTx(unsignedTx, options, isClassic)
              const result = await lcd.tx.broadcastSync(signed)

              const json = JSON.stringify(
                result,
                getCircularReplacer()
              )
              // @ts-ignore
              webviewInstance.current?.postMessage(
                JSON.stringify({
                  reqId,
                  type,
                  data: json,
                })
              )
            } catch (error) {
              // @ts-ignore
              webviewInstance.current?.postMessage(
                JSON.stringify({
                  reqId,
                  type,
                  data: error?.toString(),
                })
              )
            }
            break
          }

          case RN_APIS.APPROVE_TX: {
            const connector = walletConnectors[data.handshakeTopic]

            connector?.approveRequest({
              id: data?.id,
              result: data?.result,
            })

            // @ts-ignore
            webviewInstance.current?.postMessage(
              JSON.stringify({
                reqId,
                type,
                data: true,
              })
            )
            break
          }

          case RN_APIS.REJECT_TX: {
            const connector = walletConnectors[data.handshakeTopic]

            connector?.rejectRequest({
              id: data?.id,
              error: {
                message: JSON.stringify(data?.errorMsg),
              },
            })

            // @ts-ignore
            webviewInstance.current?.postMessage(
              JSON.stringify({
                reqId,
                type,
                data: true,
              })
            )
            break
          }
        }
      }
    },
    [webviewInstance, user, localWalletConnector, walletConnectors]
  )

  const confirmConnect = useCallback(
    async ({ userAddress }) => {
      if (localWalletConnector) {
        const { peerMeta } = localWalletConnector

        // @ts-ignore
        if (peerMeta === 'null' || !peerMeta) {
          setLocalWalletConnector(null)
          return
        } else {
          await localWalletConnector.approveSession({
            chainId: chain.current.walletconnectID,
            accounts: [userAddress],
          })
        }

        saveWalletConnector(localWalletConnector)

        return peerMeta?.name ? true : false
      }
    },
    [localWalletConnector]
  )

  const connect = async ({
    uri,
    reqId,
    type,
  }: any): Promise<void> => {
    try {
      const connector = newWalletConnect({ uri })

      if (!connector.connected) {
        await connector.createSession()
      }
      setLocalWalletConnector(connector)
      connector.on('session_request', (error, payload) => {
        if (error) {
          setLocalWalletConnector(null)
          // @ts-ignore
          webviewInstance.current?.postMessage(
            JSON.stringify({
              reqId,
              type,
              data: 'Error: Fail session_request',
            })
          )
          return
        }

        const { peerMeta } = payload.params[0]

        // @ts-ignore
        webviewInstance.current?.postMessage(
          JSON.stringify({
            reqId,
            type,
            data: peerMeta,
          })
        )
      })
    } catch (error) {
      // @ts-ignore
      webviewInstance.current?.postMessage(
        JSON.stringify({
          reqId,
          type,
          data: 'Error: Fail session_request',
        })
      )
    }
  }

  const onBackPress = () => {
    if (webviewInstance && webviewInstance.current && canGoBack) {
      // @ts-ignore
      webviewInstance.current?.goBack()
      return true
    } else {
      if (isExit === false) {
        isExit = true
        ToastAndroid.show(
          'Click once more to exit.',
          ToastAndroid.SHORT
        )
        exitAppTimeout = setTimeout(
          () => {
            isExit = false
          },
          2000 // 2초
        )
        return true
      } else {
        if (exitAppTimeout !== null) {
          clearTimeout(exitAppTimeout)
        }
        BackHandler.exitApp() // 앱 종료
        return true
      }
    }
  }

  const handleAppStateChange = useCallback(
    async (nextAppState: string): Promise<void> => {
      if (
        // nextAppState.match(/inactive|background/)
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        if (!localWalletConnector?.connected) {
          try {
            localWalletConnector?.rejectSession()
          } catch (e) {
            console.log('handleAppStateChange', e)
          }
        }
      }

      appState.current = nextAppState
    },
    [localWalletConnector]
  )

  const searchLedger = useCallback(() => {
    let stopScan = (): void => {}

    TransportBLE.observeState({
      next: (e: any) => {
        if (e.available) {
          setScanning(true)
          setError('')

          const scan = TransportBLE.listen({
            complete: (): void => {
              setScanning(false)
            },
            next: (e: any): void => {
              if (e.type === 'add') {
                const device: DeviceInterface = {
                  name: e.descriptor.localName || e.descriptor.name,
                  id: e.descriptor.id,
                }
                setLedgers([...ledgers, device])
              }
            },
            error: (error: any): void => {
              setScanning(false)
              setError(error)
            },
          })
          stopScan = (): void => {
            scan.unsubscribe()
          }
        } else {
          setError(e.type)
        }
      },
      complete: (): void => {},
      error: (error: any): void => {
        setScanning(false)
        setError(error)
      },
    })

    return (): void => {
      stopScan()
    }
  }, [])

  useEffect(() => {
    if (ledgers) {
      // @ts-ignore
      webviewInstance.current?.postMessage(
        JSON.stringify({
          reqId: ledgerReqId,
          type: RN_APIS.GET_LEDGER_LIST,
          data: ledgers,
        })
      )
    }
  }, [ledgers, ledgerReqId, webviewInstance])

  useEffect(() => {
    if (_.some(walletConnectors)) {
      _.forEach(walletConnectors, (connector) => {
        const handshakeTopic = connector.handshakeTopic

        connector.on('disconnect', () => {
          removeWalletConnect(handshakeTopic)

          // @ts-ignore
          webviewInstance.current?.postMessage(
            JSON.stringify({
              reqId: '',
              type: RN_APIS.DISCONNECT_SESSIONS,
              data: handshakeTopic,
            })
          )
        })
      })
    }
  }, [walletConnectors])

  useEffect(() => {
    BackHandler.addEventListener('hardwareBackPress', onBackPress)
    return (): void => {
      BackHandler.removeEventListener(
        'hardwareBackPress',
        onBackPress
      )
    }
  }, [canGoBack, onBackPress])

  useEffect(() => {
    AppState.addEventListener('change', handleAppStateChange)
    return (): void => {
      AppState.removeEventListener('change', handleAppStateChange)
    }
  }, [handleAppStateChange])

  return (
    <WebView
      ref={webviewInstance}
      source={{
        uri
      }}
      onShouldStartLoadWithRequest={(request) => {
        if (!request.url.includes(uri)) {
          Linking.openURL(request.url)
          return false
        }
        return true
      }}
      allowsBackForwardNavigationGestures
      autoManageStatusBarEnabled={false}
      scrollEnabled={false}
      contentInsetAdjustmentBehavior="scrollableAxes"
      onMessage={async (message) => {
        const { nativeEvent } = message
        if (nativeEvent.data === 'navigationStateChange') {
          SetCanGoBack(nativeEvent.canGoBack)
          return
        }
        const req = nativeEvent.data && JSON.parse(nativeEvent.data)
        await WebViewListener(req)
      }}
      injectedJavaScript={`
        (function() {
          function wrap(fn) {
            return function wrapper() {
              var res = fn.apply(this, arguments);
              window.ReactNativeWebView.postMessage('navigationStateChange');
              return res;
            }
          }å
          history.pushState = wrap(history.pushState);
          history.replaceState = wrap(history.replaceState);
          window.addEventListener('popstate', function() {
            window.ReactNativeWebView.postMessage('navigationStateChange');
          });
        })();
        true;
      `}
    />
  )
}