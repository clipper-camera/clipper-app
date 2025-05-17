import {
  CameraMode,
  CameraType,
  CameraView,
  useCameraPermissions,
} from "expo-camera";
import { useRef, useState, useCallback, useEffect } from "react";
import { ImageBackground, Button, Pressable, StyleSheet, Text, View, Dimensions, SafeAreaView, TouchableOpacity, StatusBar, Alert, PanResponder } from "react-native";
import { Image } from "expo-image";
import { AntDesign } from "@expo/vector-icons";
import { Feather } from "@expo/vector-icons";
import { FontAwesome6 } from "@expo/vector-icons";
import { Video, ResizeMode } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { messageService } from '../services/messageService';
import { TextOverlay, uploadService } from '../services/uploadService';
import { settingsService } from '../services/settingsService';
import { ReceivedMessage } from '../services/messageService';
import { serverHealthService } from '../services/serverHealthService';

type RootStackParamList = {
  Home: undefined;
  Preview: { mediaUri: string; mediaType: 'image' | 'video', canSend: boolean, textOverlays?: TextOverlay[] };
  Contacts: { mediaUri: string; mediaType: 'image' | 'video',  textOverlays?: TextOverlay[] };
  Settings: undefined;
  ReceivedMessages: undefined;
};

type HomeScreenProps = NativeStackScreenProps<RootStackParamList, 'Home'>;

export default function HomeScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const ref = useRef<CameraView>(null);
  const [userMode, setUserMode] = useState<"usermode_picture" | "usermode_video">("usermode_video");
  const [facing, setFacing] = useState<CameraType>("back");
  const [recording, setRecording] = useState(false);
  const [isStartingRecording, setIsStartingRecording] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [cameraMode, setCameraMode] = useState<CameraMode>("video");
  const [isCameraReady, setIsCameraReady] = useState(false);
  const takePicturePromiseRef = useRef<((value: void) => void) | null>(null);
  const navigation = useNavigation<HomeScreenProps['navigation']>();
  const [hasUnviewedMessages, setHasUnviewedMessages] = useState(false);
  const [isPressing, setIsPressing] = useState(false);
  const [initialY, setInitialY] = useState(0);
  const [currentY, setCurrentY] = useState(0);
  const [holdTimerCompleted, setHoldTimerCompleted] = useState(false);
  const touchCountRef = useRef(0);
  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);
  const activeTouchesRef = useRef<Set<number>>(new Set());
  const [isWaitingForCamera, setIsWaitingForCamera] = useState(false);
  const [isTakingPicture, setIsTakingPicture] = useState(false);

  const checkSettings = async () => {
    try {
      const settings = await settingsService.getSettings();
      if (!settings.userApiKey || !settings.apiEndpoint) {
        navigation.navigate('Settings');
        return;
      }
    } catch (error) {
      console.error('Error checking settings:', error);
    }
  };

  // Check settings every time the screen comes into focus
  useFocusEffect(
    useCallback(() => {
      console.log('Home screen focused, checking settings...');
      checkSettings();
  
      // Reset UI states when returning to HomeScreen
      setIsTakingPicture(false);
      setIsPressing(false);
      setZoom(0);
      setUserMode("usermode_video");
      setCameraMode("video");
      setRecording(false);
      setIsStartingRecording(false);
      setHoldTimerCompleted(false);
      setIsCameraReady(false);
      setIsWaitingForCamera(false);
      touchCountRef.current = 0;
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }

      // Add a small delay to ensure camera reinitialization
      const timer = setTimeout(() => {
        setIsCameraReady(true);
      }, 500);

      console.log('UI states reset:', {
        userMode,
        cameraMode,
        recording,
        isPressing,
        isStartingRecording,
        holdTimerCompleted,
        isCameraReady
      });

      // Cleanup function to reset states when screen loses focus
      return () => {
        console.log('Home screen unfocused');
        clearTimeout(timer);
        setIsTakingPicture(false);
        setIsPressing(false);
        setZoom(0);
        setUserMode("usermode_video");
        setCameraMode("video");
        setRecording(false);
        setIsStartingRecording(false);
        setHoldTimerCompleted(false);
        setIsCameraReady(false);
        setIsWaitingForCamera(false);
        touchCountRef.current = 0;
        if (holdTimerRef.current) {
          clearTimeout(holdTimerRef.current);
          holdTimerRef.current = null;
        }
      };
    }, [])
  );

  useEffect(() => {
    // Check for unviewed messages
    const checkUnviewed = async () => {
      try {
        setHasUnviewedMessages(messageService.hasUnviewedMessages());
      } catch (error) {
        // Silently handle errors - don't show to user
        console.log('Error checking messages:', error);
      }
    };

    // Check immediately
    checkUnviewed();

    // Then check every 5 seconds instead of every minute
    const interval = setInterval(checkUnviewed, 5000);

    return () => {
      clearInterval(interval);
    };
  }, []);

  // Add focus effect to update notification state when returning to home screen
  useFocusEffect(
    useCallback(() => {
      const checkUnviewed = async () => {
        try {
          setHasUnviewedMessages(messageService.hasUnviewedMessages());
        } catch (error) {
          console.log('Error checking messages:', error);
        }
      };
      checkUnviewed();
    }, [])
  );

  // Handle hold timer effect
  useEffect(() => {
    if (isPressing && !recording) {
      holdTimerRef.current = setTimeout(() => {
        console.log('Hold timer triggered - switching to video mode');
        setUserMode("usermode_video");
        setHoldTimerCompleted(true);
      }, 200);
    } else if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      setHoldTimerCompleted(false);
    }

    return () => {
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
      }
    };
  }, [isPressing, recording]);

  if (!permission) {
    return null;
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={{ textAlign: "center" }}>
          We need your permission to use the camera
        </Text>
        <Button onPress={requestPermission} title="Grant permission" />
      </View>
    );
  }

  const saveMediaToLocal = async (mediaUri: string) => {
    const timestamp = new Date().getTime();
    const extension = mediaUri.split('.').pop();
    const fileName = `${timestamp}.${extension}`;
    const clipperDir = `${FileSystem.cacheDirectory}Clipper/`;
    console.log('Saving to:', clipperDir);
    
    try {
      // Check if Clipper directory exists, if not create it
      const dirInfo = await FileSystem.getInfoAsync(clipperDir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(clipperDir, { intermediates: true });
      }

      const destination = `${clipperDir}${fileName}`;
      await FileSystem.copyAsync({
        from: mediaUri,
        to: destination,
      });
      console.log('File saved successfully to:', destination);
      return destination;
    } catch (error) {
      console.error('Error saving media:', error);
      return null;
    }
  };

  const takePicture = async () => {
    const photo = await ref.current?.takePictureAsync({
       skipProcessing: false,
       shutterSound: false,
       quality: 0.6,
    });
    if (photo?.uri) {
      const savedUri = await saveMediaToLocal(photo.uri);
      if (savedUri) {
        navigation.navigate('Preview', { mediaUri: savedUri, mediaType: 'image', canSend: true });
      }
    }
  };

  const handleTouchStart = (event: any) => {
    console.log('Touch start triggered');
    touchCountRef.current += 1;
    
    if (touchCountRef.current === 1) {
      setIsPressing(true);
      setInitialY(event.nativeEvent.pageY);
      setCurrentY(event.nativeEvent.pageY);
      setHoldTimerCompleted(false);
    }
  };

  const handleTouchMove = (event: any) => {
    const newY = event.nativeEvent.pageY;
    setCurrentY(newY);
    
    // Calculate zoom based on vertical movement - enable zoom immediately
    const deltaY = initialY - newY;
    const newZoom = Math.min(Math.max(0, deltaY / 100), 1); // Limit zoom between 0 and 1
    console.log('newZoom', newZoom);
    setZoom(newZoom);
    
    // Only start recording if we've held the button for the required time
    if (!recording && !isStartingRecording && userMode === "usermode_video" && isPressing && holdTimerCompleted) {
      if (!ref.current) {
        setUserMode("usermode_picture");
        setZoom(0);
        return;
      }
      
      console.log('Starting VIDEO recording...');
      setIsStartingRecording(true);
      setRecording(true);
      ref.current.recordAsync().then(async (result) => {
        if (result?.uri) {
          const savedUri = await saveMediaToLocal(result.uri);
          if (savedUri) {
            navigation.navigate('Preview', { mediaUri: savedUri, mediaType: 'video', canSend: true });
            setUserMode("usermode_picture");
            setZoom(0);
          }
        }
      }).catch(error => {
        console.log('Error starting recording:', error);
        setRecording(false);
        setUserMode("usermode_picture");
        setZoom(0);
      }).finally(() => {
        setIsStartingRecording(false);
      });
    }
  };

  const handleCameraReady = () => {
    console.log('Camera is ready');
    setIsCameraReady(true);
    if (takePicturePromiseRef.current) {
      takePicturePromiseRef.current();
      takePicturePromiseRef.current = null;
    }
  };

  const waitForCameraReady = async () => {
    if (isCameraReady) return;
    return new Promise<void>(resolve => {
      takePicturePromiseRef.current = resolve;
    });
  };

  const handleTouchEnd = async () => {
    console.log('Touch end triggered, recording state:', recording);
    touchCountRef.current = Math.max(0, touchCountRef.current - 1);
    console.log('Touch count:', touchCountRef.current);
    
    if (touchCountRef.current === 0) {
      setIsPressing(false);
      setHoldTimerCompleted(false);
    }

    if (recording && touchCountRef.current === 0) {
      try {
        console.log('Attempting to stop recording...');
        await ref.current?.stopRecording();
        console.log('Recording stopped');
        setRecording(false);
      } catch (error) {
        console.log('DEBUG: Error stopping recording:', error);
        setRecording(false);
        setUserMode("usermode_picture");
        setZoom(0);
      }
    } else if (!recording && Math.abs(currentY - initialY) < 50) {
      // If we're not recording and the hold timer hasn't completed, take a picture
      if (!holdTimerCompleted) {
        try {
          if (!ref.current) {
            console.log('DEBUG: Camera ref is null, switching back to picture mode');
            setUserMode("usermode_picture");
            setZoom(0);
            return;
          }

          // Ensure camera is ready before proceeding
          await waitForCameraReady();

          // Switch camera to picture mode
          setIsCameraReady(false);
          setCameraMode("picture");
          
          // Wait for camera to be ready in picture mode
          console.log('Waiting for camera to be ready in picture mode...');
          await waitForCameraReady();
          
          // Double check mode and add a small delay
          if (cameraMode !== "picture") {
            console.log('Camera not in picture mode, retrying...');
            setCameraMode("picture");
            await new Promise(resolve => setTimeout(resolve, 100));
            await waitForCameraReady();
          }
          
          setIsTakingPicture(true);
          console.log('Camera is ready and in picture mode, taking picture...');
          const photo = await ref.current.takePictureAsync({
            skipProcessing: false,
            shutterSound: false,
            quality: 1.0,
            base64: false,
            exif: false,
            imageType: 'jpg',
          });
          
          console.log('Picture taken:', photo);
          if (photo?.uri) {
            console.log('Saving picture to local storage...');
            const savedUri = await saveMediaToLocal(photo.uri);
            console.log('Picture saved to:', savedUri);
            if (savedUri) {
              console.log('Navigating to preview screen with image...');
              navigation.navigate('Preview', { mediaUri: savedUri, mediaType: 'image', canSend: true });
            }
          } else {
            console.log('DEBUG: No photo URI received, switching back to picture mode');
            setUserMode("usermode_picture");
            setZoom(0);
          }

          // Switch back to video mode
          setIsTakingPicture(false);
          setIsCameraReady(false);
          setCameraMode("video");
          await waitForCameraReady();
        } catch (error) {
          console.log('DEBUG: Error taking picture:', error);
          setUserMode("usermode_picture");
          setZoom(0);
          setIsTakingPicture(false);
          // Ensure we switch back to video mode even if there's an error
          setIsCameraReady(false);
          setCameraMode("video");
        }
      } else if (userMode === "usermode_video") {
        console.log('DEBUG: Switching back to picture mode - video mode not started');
        setUserMode("usermode_picture");
        setZoom(0);
        return;
      }
    }
  };

  const toggleMode = () => {
    setUserMode((prev) => (prev === "usermode_picture" ? "usermode_video" : "usermode_picture"));
  };

  const toggleFacing = () => {
    setFacing((prev) => (prev === "back" ? "front" : "back"));
  };

  return (
    <View style={styles.container}>
      <CameraView
        ref={ref}
        style={styles.camera}
        mode={cameraMode}
        facing={facing}
        mute={true}
        flash="off"
        responsiveOrientationWhenOrientationLocked={false}
        autofocus="on"
        animateShutter={false}
        zoom={zoom}
        onCameraReady={handleCameraReady}
      />

      {/* Settings and Notification buttons */}
      <Pressable 
        onPress={() => navigation.navigate('Settings')} 
        style={styles.settingsButton}
      >
        <FontAwesome6 name="gear" size={24} color="white" />
      </Pressable>
      <Pressable 
        style={styles.notificationButton}
        onPress={() => navigation.navigate('ReceivedMessages')}
      >
        <FontAwesome6 name="bell" size={24} color="white" />
        {hasUnviewedMessages && <View style={styles.notificationDot} />}
      </Pressable>

      {/* Mode indicator and camera switch */}
      <View style={styles.topControls}>
        <View style={styles.modeIndicator}>
          <View style={styles.modeContent}>
            {userMode === "usermode_picture" ? (
              <FontAwesome6 name="camera" size={14} color="white" style={styles.modeIcon} />
            ) : (
              <FontAwesome6 name="video" size={14} color="white" style={styles.modeIcon} />
            )}
            <Text style={styles.modeText}>
              {userMode === "usermode_picture" ? "PHOTO" : "VIDEO"}
            </Text>
          </View>
        </View>
        <Pressable 
          onPress={recording ? undefined : toggleFacing} 
          style={[styles.cameraSwitchButton, recording && styles.disabledButton]}
        >
          <FontAwesome6 name="camera-rotate" size={14} color="white" style={styles.cameraSwitchIcon} />
          <Text style={[styles.cameraSwitchText, recording && styles.disabledText]}>
            {facing === "back" ? "BACK" : "FRONT"}
          </Text>
        </Pressable>
      </View>

      {/* Shutter button and hold still text */}
      <View style={styles.shutterContainer}>
        <View style={styles.shutterContent}>
          {isTakingPicture && (
            <Text style={styles.holdStillText}>HOLD STILL</Text>
          )}
          <View
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <View
              style={[
                styles.shutterBtn,
                {
                  opacity: isPressing ? 0.5 : 1,
                },
              ]}
            >
              <View
                style={[
                  styles.shutterBtnInner,
                  {
                    backgroundColor: recording ? "red" : "white",
                  },
                ]}
              />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
    alignItems: "center",
    justifyContent: "center",
  },
  camera: {
    flex: 1,
    width: "100%",
  },
  settingsButton: {
    position: 'absolute',
    top: 25,
    left: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  shutterContainer: {
    position: "absolute",
    bottom: 44,
    left: 0,
    width: "100%",
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    paddingHorizontal: 30,
  },
  renderPictureBtn1: {
    justifyContent: "flex-start",
    paddingHorizontal: 50,
  },
  renderPictureBtn2: {
    justifyContent: "flex-end",
    paddingHorizontal: 50,
  },
  shutterBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: "white",
    justifyContent: "center",
    alignItems: "center",
  },
  shutterBtnInner: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "white",
  },
  notificationButton: {
    position: 'absolute',
    top: 75,
    left: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  notificationDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 8,
    height: 8,
    borderRadius: 6,
    backgroundColor: '#ff3b30',
  },
  topControls: {
    position: 'absolute',
    top: 32,
    right: 20,
    alignItems: 'flex-end',
  },
  modeIndicator: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 15,
    marginBottom: 8,
  },
  modeContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modeIcon: {
    marginRight: 4,
  },
  modeText: {
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
  },
  cameraSwitchButton: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
  },
  disabledButton: {
    opacity: 0.5,
  },
  disabledText: {
    opacity: 0.5,
  },
  cameraSwitchIcon: {
    marginRight: 4,
  },
  cameraSwitchText: {
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
  },
  shutterContent: {
    alignItems: 'center',
  },
  holdStillText: {
    color: 'yellow',
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: -1, height: 1 },
    textShadowRadius: 10,
  },
}); 