// 사용자 목표
export type BodyGoalType = 'diet' | 'bulking' | 'lean_bulk' | 'maintenance' | 'recomp';
export type HealthDietType = 'low_sodium' | 'low_carb' | 'diabetic' | 'low_fat' | 'high_protein' | 'intermittent_fasting' | 'anti_inflammatory' | 'none_health';
export type LifestyleDietType = 'vegetarian' | 'vegan' | 'pescatarian' | 'flexitarian' | 'ketogenic' | 'paleo' | 'gluten_free' | 'none_lifestyle';
export type AppThemeMode = 'light' | 'dark' | 'system';

// 사용자 프로필
export interface UserProfile {
  id: string;
  email: string;
  name: string;

  // App account fields (optional for compatibility)
  username?: string;
  nickname?: string;

  // Profile avatar (Supabase Storage path)
  avatarPath?: string;
  
  // New fields
  bodyGoal: BodyGoalType;
  healthDiet: HealthDietType;
  lifestyleDiet: LifestyleDietType;
  allergens: string[];
  
  // Plan & Quota
  plan_id?: 'free' | 'plus' | 'pro' | 'premium' | 'master';
  premium_quota_remaining?: number;
  free_image_quota_remaining?: number;
  chatTokensMonth?: string;
  chatTokensUsed?: number;
  themeMode?: AppThemeMode;

  // Legacy fields (optional for compatibility)
  goal?: string;
  dietType?: string;
  disliked?: string[];
  
  targetCalories?: number;
  targetCarbs?: number;
  targetProtein?: number;
  targetFat?: number;
  currentWeight?: number;
  targetWeight?: number;
  height?: number;
  age?: number;
  gender?: 'male' | 'female' | 'other';
  
  onboardingCompleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ManualMealLog {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD (local)
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  foodName?: string;
  calories: number;
  carbs_g: number;
  protein_g: number;
  fat_g: number;
  imageUri?: string;
  imageBase64?: string;
  timestamp: string; // ISO
}

// 음식 적합도 등급
export type FoodGrade = 'very_good' | 'good' | 'neutral' | 'bad' | 'very_bad';

export const GRADE_LABELS: Record<FoodGrade, string> = {
  very_good: '매우 좋음',
  good: '좋음',
  neutral: '보통',
  bad: '나쁨',
  very_bad: '매우 나쁨',
};

export const GRADE_COLORS: Record<FoodGrade, string> = {
  very_good: '#22C55E', // 초록
  good: '#84CC16', // 연두
  neutral: '#EAB308', // 노랑
  bad: '#F97316', // 주황
  very_bad: '#EF4444', // 빨강
};

// 음식 분석 결과 (기존 + 신규)
export interface FoodAnalysis {
  // 기본 정보
  dishName: string;
  description: string;
  categories: string[];
  confidence: number;
  ingredients?: string[];
  allergens?: string[];

  // 사진 위 좌표 기반 오버레이(0~1 정규화)
  detections?: Array<{
    label: string;
    box: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  }>;
  
  // 영양 성분
  macros: {
    calories?: number;
    carbs_g?: number;
    protein_g?: number;
    fat_g?: number;
    sugar_g?: number;
    saturated_fat_g?: number;
    trans_fat_g?: number;
    sodium_mg?: number;
    cholesterol_mg?: number;
    fiber_g?: number;
  };
  
  // 신규: 사용자 맞춤 분석
  userAnalysis?: {
    grade: FoodGrade; // 적합도 등급
    score100?: number; // 0~100 사용자 맞춤 점수 (신규)
    pros?: string[]; // 장점(사용자 목표/식단 기준)
    cons?: string[]; // 단점/주의점(사용자 목표/식단 기준)
    goalFit?: string[]; // 목표(다이어트/벌크업 등) 적합 설명
    dietFit?: string[]; // 현재 식단(저탄/저염 등) 적합 설명
    healthImpact?: string[]; // 건강 관점 영향/주의
    reasons: string[]; // 등급 이유 (배열)
    warnings: string[]; // 알레르기/기피 경고
    alternatives: string[]; // 대체 음식 추천
    tips: string[]; // 섭취 팁
  };
  
  // 데이터 출처 및 기준
  source?: string; // 'Supabase DB (Processed Food)' | 'Supabase DB (General Food)' | 'AI Estimation (DB Not Found)' | 'AI Vision Analysis'
  referenceStandard?: string; // '100g 기준 (Per 100g)' | 'AI Estimate / Package Label' 등
  
  geminiUsed: boolean;
  geminiNotice?: string;
}

// 식단 기록
export interface FoodLog {
  id: string;
  userId: string;
  imageUri: string;
  analysis: FoodAnalysis;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  timestamp: string;
  notes?: string;
}

// 신체 기록
export interface BodyLog {
  id: string;
  userId: string;
  weight: number;
  muscleMass?: number;
  bodyFat?: number;
  timestamp: string;
}
