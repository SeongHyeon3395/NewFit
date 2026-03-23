import { Alert, Linking, PermissionsAndroid, Platform } from 'react-native';

type PermissionPromptHandlers = {
  confirmRequest?: (params: { title: string; message: string }) => Promise<boolean> | boolean;
  onNeverAskAgain?: (params: { title: string; message: string; openSettings: () => Promise<void> }) => Promise<void> | void;
};

function getPhotoLibraryPermission() {
  const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
  if (apiLevel >= 33) {
    return (PermissionsAndroid.PERMISSIONS as any).READ_MEDIA_IMAGES ?? 'android.permission.READ_MEDIA_IMAGES';
  }
  return PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;
}

async function requestPermissionWithPrompt(params: {
  permission: string;
  title: string;
  message: string;
  deniedTitle: string;
  deniedMessage: string;
}, handlers?: PermissionPromptHandlers): Promise<boolean> {
  if (Platform.OS !== 'android') return true;

  const hasPermission = await PermissionsAndroid.check(params.permission as any);
  if (hasPermission) return true;

  if (handlers?.confirmRequest) {
    try {
      const ok = await handlers.confirmRequest({ title: params.title, message: params.message });
      if (!ok) return false;

      const result = await PermissionsAndroid.request(params.permission as any);
      if (result === PermissionsAndroid.RESULTS.GRANTED) return true;

      if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
        if (handlers.onNeverAskAgain) {
          await handlers.onNeverAskAgain({
            title: params.deniedTitle,
            message: `${params.deniedMessage}\n설정에서 권한을 허용한 뒤 다시 시도해주세요.`,
            openSettings: async () => {
              await Linking.openSettings();
            },
          });
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    Alert.alert(
      params.title,
      params.message,
      [
        {
          text: '나중에',
          style: 'cancel',
          onPress: () => finish(false),
        },
        {
          text: '권한 허용',
          onPress: () => {
            void (async () => {
              try {
                const result = await PermissionsAndroid.request(params.permission as any);
                if (result === PermissionsAndroid.RESULTS.GRANTED) {
                  finish(true);
                  return;
                }

                if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
                  Alert.alert(
                    params.deniedTitle,
                    `${params.deniedMessage}\n설정에서 권한을 허용한 뒤 다시 시도해주세요.`,
                    [
                      { text: '닫기', style: 'cancel', onPress: () => finish(false) },
                      {
                        text: '설정 열기',
                        onPress: () => {
                          void Linking.openSettings().catch(() => {
                            // ignore
                          });
                          finish(false);
                        },
                      },
                    ],
                    { cancelable: true, onDismiss: () => finish(false) }
                  );
                  return;
                }

                finish(false);
              } catch {
                finish(false);
              }
            })();
          },
        },
      ],
      { cancelable: true, onDismiss: () => finish(false) }
    );
  });
}

export async function ensureCameraPermissionWithPrompt(handlers?: PermissionPromptHandlers) {
  return requestPermissionWithPrompt({
    permission: PermissionsAndroid.PERMISSIONS.CAMERA,
    title: '카메라 권한 필요',
    message: '사진을 찍으려면 카메라 권한 허용이 필요해요. 지금 바로 권한을 허용할까요?',
    deniedTitle: '카메라 권한이 꺼져 있어요',
    deniedMessage: '카메라를 사용하려면 카메라 권한이 필요해요.',
  }, handlers);
}

export async function ensurePhotoLibraryPermissionWithPrompt(handlers?: PermissionPromptHandlers) {
  return requestPermissionWithPrompt({
    permission: getPhotoLibraryPermission(),
    title: '사진 접근 권한 필요',
    message: '라이브러리에서 사진을 선택하려면 사진 접근 권한 허용이 필요해요. 지금 바로 권한을 허용할까요?',
    deniedTitle: '사진 접근 권한이 꺼져 있어요',
    deniedMessage: '사진을 선택하려면 사진 접근 권한이 필요해요.',
  }, handlers);
}
