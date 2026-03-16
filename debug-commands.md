# NutriMatch 디버깅 명령어 모음

## 1. Android 네이티브 로그 (이미 실행 중)
```powershell
adb logcat -c  # 로그 클리어
adb logcat *:E ReactNative:V ReactNativeJS:V  # 실시간 로그
```

## 2. Metro Bundler 로그 (상세 모드)
```powershell
npx react-native start --verbose
```

## 3. Android 크래시 로그만 필터링
```powershell
adb logcat -b crash
```

## 4. 특정 태그만 보기
```powershell
# ImagePicker 관련 로그
adb logcat | findstr "ImagePicker"

# FormData 관련 로그
adb logcat | findstr "FormData"

# Network 관련 로그
adb logcat | findstr "Network"
```

## 5. React Native 디버깅 메뉴
앱 실행 후 기기를 흔들거나 `adb shell input keyevent 82` 실행
- "Debug" 선택 → Chrome DevTools에서 네트워크/콘솔 확인 가능

## 6. 파일 업로드 테스트 (직접 curl)
```powershell
# Health 엔드포인트 테스트
curl https://wrgeaabfsbjdgtjcwevv.functions.supabase.co/health

# 이미지 업로드 테스트 (테스트 이미지 필요)
curl -X POST https://wrgeaabfsbjdgtjcwevv.functions.supabase.co/analyze-food-image `
  -H "apikey: YOUR_ANON_KEY" `
  -H "Authorization: Bearer YOUR_ANON_KEY" `
  -F "file=@test-image.jpg"
```

## 7. APK 빌드 후 설치 (디버그 모드)
```powershell
cd android
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## 7-1. (자주 발생) 에뮬레이터 저장공간 부족으로 설치 실패
에러 예: `INSTALL_FAILED_INSUFFICIENT_STORAGE: Failed to override installation location`

### 빠른 해결
```powershell
# 패키지명 확인 (보통 android/app/build.gradle의 applicationId)

# 기존 앱 제거 후 재설치
adb uninstall com.front
npx react-native run-android

# 반복되면 자동 정리 후 재설치
npm run android:clean
```

### 원인 점검
```powershell
adb shell df -h
```

### 재발 방지(권장)
- Android Studio > Device Manager에서 해당 AVD:
   - **Wipe Data** (용량/캐시가 꼬였을 때 가장 확실)
   - **Internal Storage / SD Card** 용량을 넉넉히(예: 8~16GB)로 설정
   - Quick Boot(스냅샷) 때문에 디스크가 계속 불어나면 **Cold Boot 위주로 사용**
- 이미 `config.ini`에 `disk.dataPartition.size=12G`가 있어도, 기존 userdata 이미지가 작게 만들어져 있으면 실제 `/data`는 더 작을 수 있음. 이 경우 **Wipe Data**를 한 번 해줘야 새 크기가 반영됨.

### (고급) AVD 설정 파일 직접 수정
`%USERPROFILE%\.android\avd\<AVD이름>.avd\config.ini`
- `disk.dataPartition.size=12G` 처럼 /data 파티션 확대
- `fastboot.forceFastBoot=no`, `fastboot.forceColdBoot=yes`로 Quick Boot 비활성화
- 변경 후에는 보통 **Wipe Data**(또는 userdata 이미지 삭제)가 필요

## 8. Hermes 디버깅
```powershell
npx react-native run-android --variant=debug
adb reverse tcp:8081 tcp:8081
```

## 현재 이슈 추적 체크리스트

### 크래시 발생 시점 확인
- [ ] ImagePicker.openCamera 호출 시?
- [ ] ImagePicker.openPicker 호출 시?
- [ ] analyzeFoodImage 호출 시?
- [ ] FormData 생성 시?
- [ ] fetch 네트워크 요청 시?
- [ ] JSON 파싱 시?

### 확인할 로그 키워드
- `FATAL EXCEPTION`
- `JavascriptException`
- `NativeModules`
- `ImagePicker`
- `FormData`
- `NetworkError`
- `OkHttp`
- `java.lang.OutOfMemoryError`
- `StackOverflowError`

### 의심되는 원인
1. **react-native-image-crop-picker 네이티브 모듈 이슈**
   - Gradle 빌드 문제
   - 권한 문제
   - 크롭 라이브러리 충돌

2. **FormData 처리 문제**
   - React Native의 FormData 구현 이슈
   - 파일 경로 형식 문제 (`file://` prefix)

3. **메모리 부족**
   - 800x800 크롭 후에도 원본 파일 크기가 클 수 있음
   - Heap 메모리 초과

4. **네트워크 스택 문제**
   - OkHttp 설정 이슈
   - SSL/TLS 인증서 문제
   - timeout 설정 문제
