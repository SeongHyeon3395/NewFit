import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Linking, Platform, StatusBar, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import { AppIcon } from '../../components/ui/AppIcon';
import { COLORS } from '../../constants/colors';
import { pickPhotoFromLibrary } from '../../services/imagePicker';
import { ensurePhotoLibraryPermissionWithPrompt } from '../../services/permissions';
import { CameraBottomBar, FlashMode } from '../../components/camera/CameraBottomBar';
import { CameraPermissionView } from '../../components/camera/CameraPermissionView';
import { TouchableOpacity } from 'react-native';

function toFileUri(pathOrUri: string) {
  if (!pathOrUri) return '';
  if (pathOrUri.startsWith('file://')) return pathOrUri;
  if (pathOrUri.startsWith('content://')) return pathOrUri;
  return `file://${pathOrUri}`;
}

export default function CameraScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();

  const { hasPermission, requestPermission } = useCameraPermission();
  const [cameraPosition, setCameraPosition] = useState<'back' | 'front'>('back');
  const [flash, setFlash] = useState<FlashMode>('auto');
  const device = useCameraDevice(cameraPosition);
  const cameraRef = useRef<Camera | null>(null);

  const [isCapturing, setIsCapturing] = useState(false);

  const flashOpacity = useSharedValue(0);
  const flashStyle = useAnimatedStyle(() => ({ opacity: flashOpacity.value }));

  const topBarHeight = (insets.top || StatusBar.currentHeight || 0) + 6;

  const canRenderCamera = !!device && hasPermission;

  const cycleFlash = useCallback(() => {
    setFlash(prev => (prev === 'auto' ? 'on' : prev === 'on' ? 'off' : 'auto'));
  }, []);

  const flipCamera = useCallback(() => {
    setCameraPosition(prev => (prev === 'back' ? 'front' : 'back'));
  }, []);

  const triggerHaptic = useCallback(() => {
    try {
      ReactNativeHapticFeedback.trigger('impactLight', {
        enableVibrateFallback: true,
        ignoreAndroidSystemSettings: false,
      });
    } catch {
      // ignore
    }
  }, []);

  const navigateToEdit = useCallback(
    (uri: string) => {
      const imageUri = toFileUri(uri);
      if (!imageUri) return;
      (navigation as any).navigate('Edit', { imageUri });
    },
    [navigation]
  );

  const openGallery = useCallback(async () => {
    try {
      triggerHaptic();
      const hasPhotoPermission = await ensurePhotoLibraryPermissionWithPrompt();
      if (!hasPhotoPermission) return;
      const picked = await pickPhotoFromLibrary({ quality: 0.84 });
      if (!picked?.uri) return;
      navigateToEdit(picked.uri);
    } catch {
      // silent
    }
  }, [navigateToEdit, triggerHaptic]);

  const takePhoto = useCallback(async () => {
    if (!cameraRef.current || !device || isCapturing) return;

    setIsCapturing(true);
    triggerHaptic();

    try {
      flashOpacity.value = withSequence(withTiming(0.85, { duration: 70 }), withTiming(0, { duration: 170 }));

      const photo = await cameraRef.current.takePhoto({
        flash: flash as any,
        enableShutterSound: true,
      });

      navigateToEdit(photo.path);
    } catch {
      // ignore
    } finally {
      setIsCapturing(false);
    }
  }, [device, flash, flashOpacity, isCapturing, navigateToEdit, triggerHaptic]);

  const requestOrSettings = useCallback(async () => {
    const res = await requestPermission();
    if (res) return;
    // If still denied, guide to settings
    try {
      await Linking.openSettings();
    } catch {
      // ignore
    }
  }, [requestPermission]);

  const headerIconColor = '#fff';

  const header = useMemo(() => {
    return (
      <View style={[styles.header, { paddingTop: topBarHeight }]}>
        <View style={styles.headerLeft}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="뒤로가기"
            onPress={() => {
              triggerHaptic();
              (navigation as any).goBack();
            }}
            style={styles.headerBtn}
          >
            <AppIcon name={'arrow-back' as any} size={22} color={headerIconColor} />
          </TouchableOpacity>
        </View>
        <View style={styles.headerRight}>
          <View style={styles.headerBtn}>
            <AppIcon name={'photo-camera' as any} size={18} color={headerIconColor} />
          </View>
        </View>
      </View>
    );
  }, [navigation, topBarHeight, triggerHaptic]);

  if (!hasPermission) {
    return (
      <SafeAreaView style={styles.permissionRoot} edges={['top', 'bottom']}>
        <CameraPermissionView
          message={
            Platform.OS === 'android'
              ? '음식 사진을 촬영하려면 카메라 권한이 필요해요.\n권한을 허용한 뒤 다시 시도해주세요.'
              : '음식 사진을 촬영하려면 카메라 권한이 필요해요.'
          }
          primaryLabel="권한 요청"
          onPressPrimary={requestOrSettings}
          showSettings
        />
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {!!device && (
        <Camera
          ref={ref => {
            cameraRef.current = ref;
          }}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive
          photo
        />
      )}

      <Animated.View pointerEvents="none" style={[styles.flashOverlay, flashStyle]} />

      {header}

      <View style={styles.bottom}>
        <CameraBottomBar
          flash={flash}
          onPressFlash={() => {
            triggerHaptic();
            cycleFlash();
          }}
          onPressFlip={() => {
            triggerHaptic();
            flipCamera();
          }}
          onPressGallery={openGallery}
          onPressShutter={takePhoto}
          shutterDisabled={!canRenderCamera || isCapturing}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'black',
  },
  permissionRoot: {
    flex: 1,
    backgroundColor: COLORS.backgroundGray,
  },
  header: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    paddingHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLeft: {
    flex: 1,
    alignItems: 'flex-start',
  },
  headerRight: {
    flex: 1,
    alignItems: 'flex-end',
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  flashOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'white',
  },
});
