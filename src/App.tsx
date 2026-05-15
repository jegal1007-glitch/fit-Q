import React, { useState, useEffect } from 'react';
import { Question, UserAnswer, WrongAnswerRecord } from './types';
import { BookOpen, User, Play, Clock, ArrowRight, RotateCcw, CheckCircle2, XCircle, ChevronRight, BarChart, LogOut, Trash2 } from 'lucide-react';
import { auth, db, signInWithGoogle, logOut, handleFirestoreError, OperationType } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, query, where, getDocs, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';

type AppState = 'login' | 'setup' | 'loading' | 'exam' | 'results' | 'wrongBank';

export default function App() {
  const [appState, setAppState] = useState<AppState>('login');
  const [user, setUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Exam Setup
  const [topic, setTopic] = useState('정보처리기사'); // Default topic
  const [questionCount, setQuestionCount] = useState<number>(10);
  const [customCount, setCustomCount] = useState<string>('');
  
  // Exam Execution
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Record<string, UserAnswer>>({});
  
  // Wrong Bank
  const [wrongBank, setWrongBank] = useState<WrongAnswerRecord[]>([]);
  const [selectedTopicFilter, setSelectedTopicFilter] = useState<string>('전체');
  
  const [expandedExplanations, setExpandedExplanations] = useState<Record<string, boolean>>({});
  
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  
  const [recordToDelete, setRecordToDelete] = useState<{recordId: string, questionId: string} | null>(null);

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const toggleExplanation = (id: string) => {
    setExpandedExplanations(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const loadWrongBank = async (uid: string) => {
    try {
      const q = query(collection(db, 'test'), where('userId', '==', uid));
      const querySnapshot = await getDocs(q);
      const uniqueRecords = new Map<string, WrongAnswerRecord>();
      
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const record: WrongAnswerRecord = {
          id: docSnap.id,
          question: data.question,
          failedAt: data.failedAt,
          correctCount: data.correctCount,
          topic: data.topic
        };
        
        if (!uniqueRecords.has(record.question.id)) {
          uniqueRecords.set(record.question.id, record);
        } else {
          // Compare dates and delete the older one
          const existing = uniqueRecords.get(record.question.id)!;
          if (record.failedAt > existing.failedAt) {
            deleteDoc(doc(db, 'test', existing.id!)).catch(console.error);
            uniqueRecords.set(record.question.id, record);
          } else {
            deleteDoc(doc(db, 'test', docSnap.id)).catch(console.error);
          }
        }
      });
      
      const records = Array.from(uniqueRecords.values());
      records.sort((a, b) => b.failedAt - a.failedAt);
      setWrongBank(records);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'test');
    }
  };

  // Load wrong bank on mount
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setAuthLoading(false);
      if (currentUser) {
        setUser(currentUser);
        setAppState('setup');
        await loadWrongBank(currentUser.uid);
      } else {
        setUser(null);
        setAppState('login');
        setWrongBank([]);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await signInWithGoogle();
      // Auth state observer will handle the state change
    } catch (error) {
      console.error(error);
      showToast('로그인에 실패했습니다. 다시 시도해주세요. 🙏');
    }
  };

  const handleLogout = async () => {
    try {
      await logOut();
    } catch (error) {
      console.error(error);
    }
  };

  const startExam = async () => {
    if (!topic.trim()) {
      showToast('준비하시는 시험 과목을 입력해주세요! 😊');
      return;
    }
    
    setAppState('loading');
    
    const countToGenerate = customCount.trim() !== '' ? parseInt(customCount, 10) : questionCount;
    const finalCount = isNaN(countToGenerate) || countToGenerate <= 0 ? 10 : countToGenerate;
    
    try {
      const res = await fetch('/api/generate-exam', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ topic, count: finalCount })
      });
      
      const data = await res.json();
      if (data.questions) {
        setQuestions(data.questions);
        setCurrentQuestionIndex(0);
        setUserAnswers({});
        setAppState('exam');
      } else {
        showToast("문제 생성 중 문제가 발생했어요. 잠시 후 다시 시도해주세요. 🙏");
        setAppState('setup');
      }
    } catch (err) {
      console.error(err);
      showToast("서버와 연결할 수 없어요. 인터넷 연결을 확인해주세요. 🔌");
      setAppState('setup');
    }
  };

  const startWrongAnswersExam = () => {
    let filteredBank = wrongBank;
    if (selectedTopicFilter !== '전체') {
      filteredBank = wrongBank.filter(r => (r.topic || '기타') === selectedTopicFilter);
    }
    
    if (filteredBank.length === 0) return;
    
    // Create an exam from the wrong bank
    const questionsFromBank = filteredBank.map(record => record.question);
    
    // Sort randomly to mix them up (optional, but good for studying)
    const shuffled = [...questionsFromBank].sort(() => Math.random() - 0.5);
    
    // Let's take up to the user selected count, or all if short
    const countToGenerate = customCount.trim() !== '' ? parseInt(customCount, 10) : questionCount;
    const finalCount = isNaN(countToGenerate) || countToGenerate <= 0 ? 10 : countToGenerate;
    
    const selectedQuestions = shuffled.slice(0, finalCount);
    
    setQuestions(selectedQuestions);
    setTopic("오답 노트 복습");
    setCurrentQuestionIndex(0);
    setUserAnswers({});
    setAppState('exam');
  };

  const deleteWrongBankRecord = async (recordId: string, questionId: string) => {
    if (!recordId) return;
    
    try {
      // Find all duplicate docs with the same question ID and delete them
      if (user) {
         const q = query(collection(db, 'test'), where('userId', '==', user.uid));
         const querySnapshot = await getDocs(q);
         const docsToDelete: string[] = [];
         
         querySnapshot.forEach(docSnap => {
           const data = docSnap.data();
           if (data.question && data.question.id === questionId) {
             docsToDelete.push(docSnap.id);
           }
         });
         
         if (docsToDelete.length > 0) {
           await Promise.all(docsToDelete.map(id => deleteDoc(doc(db, 'test', id))));
         } else {
           // Fallback in case query didn't catch it
           await deleteDoc(doc(db, 'test', recordId));
         }
         
         await loadWrongBank(user.uid);
         showToast("오답 노트에서 문제가 성공적으로 삭제되었습니다. 🗑️");
      }
    } catch (e) {
      console.error("Firestore DELETE error: ", e);
      try { handleFirestoreError(e, OperationType.DELETE, `test/${recordId}`); } catch(err) { console.error(err); }
      showToast("삭제 중 오류가 발생했어요. 잠시 후 다시 시도해주세요. 🙏");
    }
  };

  const handleOptionSelect = (optionIndex: number) => {
    const question = questions[currentQuestionIndex];
    setUserAnswers(prev => ({
      ...prev,
      [question.id]: {
        questionId: question.id,
        selectedOptionIndex: optionIndex,
        isCorrect: optionIndex === question.correctAnswerIndex
      }
    }));
  };

  const nextQuestion = () => {
    const question = questions[currentQuestionIndex];
    if (userAnswers[question.id] === undefined) {
      showToast("정답을 선택해주세요! 빈칸으로 제출할 수 없습니다. 😉");
      return;
    }
    
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
    } else {
      finishExam();
    }
  };

  const finishExam = async () => {
    if (!user || isSubmitting) return;
    setIsSubmitting(true);
    
    try {
      // Process answers and update wrong bank
      const updatedBank = [...wrongBank];
      
      for (const q of questions) {
        const answer = userAnswers[q.id];
        const existingIdx = updatedBank.findIndex(r => r.question.id === q.id);
        
        if (!answer || !answer.isCorrect) {
          // Failed this time
          if (existingIdx === -1) {
            const newDocRef = doc(collection(db, 'test'));
            
            // Clean question object to remove undefined values for Firestore
            const cleanQuestion = JSON.parse(JSON.stringify(q));
            
            const recordData = {
              userId: user.uid,
              question: cleanQuestion,
              failedAt: Date.now(),
              correctCount: 0,
              topic: topic
            };
            try {
              await setDoc(newDocRef, recordData);
              updatedBank.push({
                id: newDocRef.id,
                question: q,
                failedAt: recordData.failedAt,
                correctCount: 0,
                topic: topic
              });
            } catch (e) {
              console.error("Firestore CREATE error: ", e);
              try { handleFirestoreError(e, OperationType.CREATE, 'test'); } catch (err) { console.error(err); }
            }
          } else {
            // Failed again, update timestamp and reset correctCount
            const recordId = updatedBank[existingIdx].id!;
            const newFailedAt = Date.now();
            try {
              await updateDoc(doc(db, 'test', recordId), {
                failedAt: newFailedAt,
                correctCount: 0
              });
              updatedBank[existingIdx].failedAt = newFailedAt;
              updatedBank[existingIdx].correctCount = 0;
            } catch (e) {
              console.error("Firestore UPDATE error: ", e);
              try { handleFirestoreError(e, OperationType.UPDATE, `test/${recordId}`); } catch (err) { console.error(err); }
            }
          }
        } else {
          // Answered correctly this time
          if (existingIdx !== -1) {
            const recordId = updatedBank[existingIdx].id!;
            const newCount = (updatedBank[existingIdx].correctCount || 0) + 1;
            try {
              if (newCount >= 2) {
                await deleteDoc(doc(db, 'test', recordId));
              } else {
                await updateDoc(doc(db, 'test', recordId), {
                  correctCount: newCount
                });
              }
              updatedBank[existingIdx].correctCount = newCount;
            } catch (e) {
              console.error("Firestore UPDATE/DELETE error: ", e);
              try { handleFirestoreError(e, OperationType.UPDATE, `test/${recordId}`); } catch (err) { console.error(err); }
            }
          }
        }
      }

      // Remove questions that have been answered correctly 2 or more times
      const finalBank = updatedBank.filter(r => (r.correctCount || 0) < 2);
      
      finalBank.sort((a, b) => b.failedAt - a.failedAt); // newest first
      
      setWrongBank(finalBank);

      setAppState('results');
    } catch (e) {
      console.error("General error finishing exam:", e);
      showToast("결과 저장 중 예상치 못한 오류가 발생했습니다. 잠시 후 시도해주세요. 🙏");
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentQuestion = questions[currentQuestionIndex];
  const totalQuestions = questions.length;
  const answeredCount = Object.keys(userAnswers).length;

  return (
    <div className="h-[100dvh] overflow-hidden bg-slate-50 font-sans text-slate-900 selection:bg-blue-100 flex flex-col md:items-center">
      
      {/* Header */}
      <header className="shrink-0 w-full bg-white shadow-sm px-4 md:px-6 py-3 md:py-4 flex flex-col sm:flex-row sm:items-center justify-between z-10 md:max-w-3xl gap-2 sm:gap-0">
        <div>
          <div className="flex items-center space-x-2 text-blue-600 font-bold text-xl md:text-2xl tracking-tight">
            <div className="w-7 h-7 md:w-8 md:h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white text-base md:text-lg shadow-sm">Q</div>
            <span>FIT-Q</span>
          </div>
          <p className="hidden md:block text-xs text-slate-500 mt-1">나의 현재 실력과 취약점에 딱 맞는(Fit) 맞춤형 문제(Question)를 제공합니다</p>
        </div>
        {user && appState !== 'login' && (
          <div className="flex items-center space-x-3 md:space-x-4">
            <button 
              onClick={() => setAppState('wrongBank')}
              className="text-xs md:text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 px-2.5 md:px-3 py-1.5 rounded-full transition-colors flex items-center space-x-1"
            >
              <BarChart className="w-3.5 h-3.5 md:w-4 md:h-4" />
              <span className="hidden sm:inline">오답노트</span>
              <span className="sm:hidden">오답</span>
              {wrongBank.length > 0 && (
                <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {wrongBank.length}
                </span>
              )}
            </button>
            <div className="hidden sm:flex items-center space-x-2 text-sm font-medium text-slate-500 border-l border-slate-200 pl-3 md:pl-4">
              <User className="w-4 h-4" />
              <span className="truncate max-w-[100px] md:max-w-xs">{user.displayName || user.email?.split('@')[0]}</span>
            </div>
            <button onClick={handleLogout} className="text-slate-400 hover:text-slate-600 ml-1 md:ml-2">
              <LogOut className="w-4 h-4 md:w-5 md:h-5" />
            </button>
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <main className="flex-1 min-h-0 overflow-y-auto w-full flex flex-col md:max-w-3xl md:w-full md:border-x md:border-slate-100 bg-white scroll-smooth relative">
        
        {/* LOGIN STATE */}
        {appState === 'login' && (
          <div className="flex-1 flex flex-col items-center justify-center p-6 bg-slate-50">
            {authLoading ? (
              <div className="flex flex-col items-center">
                <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4"></div>
                <p className="text-slate-500">인증 정보를 확인하는 중...</p>
              </div>
            ) : (
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100 w-full max-w-sm">
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center text-white text-4xl font-bold mx-auto mb-4 shadow-md">
                  Q
                </div>
                <h1 className="text-2xl font-bold text-slate-800">FIT-Q 로그인</h1>
                <p className="text-slate-500 text-sm mt-3 leading-relaxed">
                  나의 현재 실력과 취약점에 딱 맞는(Fit)<br />
                  맞춤형 문제(Question)를 제공합니다
                </p>
              </div>
              <form onSubmit={handleLogin} className="space-y-4">
                <button 
                  type="submit" 
                  className="w-full bg-white border border-slate-300 text-slate-700 font-medium py-3 rounded-xl hover:bg-slate-50 active:transform active:scale-[0.98] transition-all flex justify-center items-center space-x-3"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  <span>Google로 시작하기</span>
                </button>
              </form>
            </div>
            )}
          </div>
        )}

        {/* SETUP STATE */}
        {appState === 'setup' && (
          <div className="flex-1 p-4 md:p-8 flex flex-col">
            <h2 className="text-xl md:text-2xl font-bold text-slate-800 mb-4 md:mb-6">모의고사 설정</h2>
            
            <div className="space-y-6 md:space-y-8 flex-1">
              {/* Topic Selection */}
              <section className="space-y-2 md:space-y-3">
                <label className="text-base md:text-lg font-semibold text-slate-800 flex items-center space-x-2">
                  <span className="w-5 h-5 md:w-6 md:h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs md:text-sm">1</span>
                  <span>어떤 시험을 준비하시나요?</span>
                </label>
                <input 
                  type="text" 
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  className="w-full px-4 py-2.5 md:py-3 bg-slate-50 border border-slate-200 rounded-xl text-base md:text-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                  placeholder="예: 정보처리기사, 산업안전기사..." 
                />
              </section>

              {/* Question Count Selection */}
              <section className="space-y-3 md:space-y-4">
                <div className="flex items-center justify-between">
                  <label className="text-base md:text-lg font-semibold text-slate-800 flex items-center space-x-2">
                    <span className="w-5 h-5 md:w-6 md:h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs md:text-sm">2</span>
                    <span>몇 문제를 푸시겠어요?</span>
                  </label>
                  <div className="hidden sm:flex text-sm text-slate-500 items-center space-x-1">
                    <Clock className="w-4 h-4" />
                    <span>남는 시간에 맞춰 선택하세요</span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 md:gap-3">
                  {[
                    { count: 10, label: '짧게', desc: '~10분' },
                    { count: 30, label: '중간', desc: '~30분' },
                    { count: 60, label: '길게', desc: '~60분' }
                  ].map(opt => (
                    <button
                      key={opt.count}
                      onClick={() => { setQuestionCount(opt.count); setCustomCount(''); }}
                      className={`p-2.5 md:p-4 rounded-xl md:rounded-2xl border-2 text-center transition-all ${
                        questionCount === opt.count && !customCount
                          ? 'border-blue-600 bg-blue-50 text-blue-700'
                          : 'border-slate-100 hover:border-slate-200 bg-white text-slate-600'
                      }`}
                    >
                      <div className="text-xl md:text-2xl font-bold mb-0.5 md:mb-1">{opt.count}개</div>
                      <div className="text-xs md:text-sm font-medium">{opt.label}</div>
                      <div className="hidden md:block text-xs opacity-70 mt-1">{opt.desc}</div>
                    </button>
                  ))}
                </div>
                
                <div className="pt-1 md:pt-2">
                  <div className="flex items-center space-x-3">
                    <span className="text-sm text-slate-500 whitespace-nowrap">직접 입력:</span>
                    <input 
                      type="number" 
                      min="1"
                      max="100"
                      value={customCount}
                      onChange={(e) => {
                        setCustomCount(e.target.value);
                      }}
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="원하는 문제 수 입력..."
                    />
                  </div>
                </div>
              </section>

               {/* Quick Start for Wrong Answers */}
               {wrongBank.length > 0 && (
                <section className="bg-orange-50 border border-orange-100 rounded-xl md:rounded-2xl p-4 md:p-5 flex flex-col sm:flex-row items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-orange-800 flex items-center space-x-2 text-sm md:text-base">
                      <BarChart className="w-4 h-4 md:w-5 md:h-5" />
                      <span>취약점 집중 공략</span>
                    </h3>
                    <p className="text-xs md:text-sm text-orange-600 mt-1">
                      오답 노트에 {wrongBank.length}문제가 기록되어 있습니다.<br className="hidden sm:block"/>틀린 문제만 다시 풀어보시겠어요?
                    </p>
                  </div>
                  <button 
                    onClick={startWrongAnswersExam}
                    className="mt-3 sm:mt-0 w-full sm:w-auto px-4 md:px-5 py-2 md:py-2.5 bg-orange-600 hover:bg-orange-700 text-white text-sm md:text-base font-medium rounded-lg md:rounded-xl transition-colors whitespace-nowrap flex justify-center"
                  >
                    오답 다시 풀기
                  </button>
                </section>
              )}
            </div>

            <div className="mt-6 md:mt-8 pt-4 border-t border-slate-100 pb-2">
              <button 
                onClick={startExam}
                className="w-full bg-slate-900 text-white font-bold text-base md:text-lg py-3.5 md:py-4 rounded-xl hover:bg-slate-800 active:transform active:scale-[0.98] transition-all flex justify-center items-center space-x-2 shadow-lg shadow-slate-200"
              >
                <Play className="w-4 h-4 md:w-5 md:h-5 fill-current" />
                <span>모의고사 시작하기</span>
              </button>
            </div>
          </div>
        )}

        {/* LOADING STATE */}
        {appState === 'loading' && (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-6">
            <div className="relative">
              <div className="w-16 h-16 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin"></div>
              <BookOpen className="w-6 h-6 text-blue-600 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 animate-pulse" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800 mb-2">AI가 시험지를 생성하고 있습니다</h2>
              <p className="text-slate-500">기출문제와 예상문제를 혼합하여<br/>사용자님에게 딱 맞는 {customCount || questionCount}문제를 준비 중입니다.</p>
            </div>
          </div>
        )}

        {/* EXAM STATE */}
        {appState === 'exam' && currentQuestion && (
          <div className="flex-1 flex flex-col p-4 md:p-8">
            <div className="flex items-center justify-between mb-5 md:mb-8">
              <div className="bg-slate-100 rounded-full px-3 md:px-4 py-1.5 text-xs md:text-sm font-bold tracking-wide text-slate-600">
                Question {currentQuestionIndex + 1} <span className="opacity-50">/ {totalQuestions}</span>
              </div>
              <div className="w-24 md:w-32 bg-slate-100 h-2 md:h-2.5 rounded-full overflow-hidden">
                <div 
                  className="bg-blue-600 h-full transition-all duration-300 ease-out"
                  style={{ width: `${((currentQuestionIndex) / totalQuestions) * 100}%` }}
                ></div>
              </div>
            </div>

            <div className="flex-1 pb-4">
              <div className="mb-4">
                <span className="inline-block px-3 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded-md">
                  {currentQuestion.subject}
                </span>
              </div>
              <h2 className="text-lg md:text-2xl font-bold text-slate-800 leading-snug md:leading-tight mb-6 md:mb-8">
                <span className="text-blue-600 mr-1.5 md:mr-2">Q.</span>
                {currentQuestion.text}
              </h2>
              
              <div className="space-y-2.5 md:space-y-3">
                {currentQuestion.options.map((option, idx) => {
                  const isSelected = userAnswers[currentQuestion.id]?.selectedOptionIndex === idx;
                  return (
                    <button
                      key={idx}
                      onClick={() => handleOptionSelect(idx)}
                      className={`w-full text-left p-3.5 md:p-4 rounded-xl border-2 transition-all flex items-start space-x-2.5 md:space-x-3
                        ${isSelected 
                          ? 'border-blue-600 bg-blue-50 text-blue-900 shadow-sm' 
                          : 'border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50 text-slate-700'
                        }
                      `}
                    >
                      <div className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center border font-semibold text-xs md:text-sm mt-0.5
                        ${isSelected ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300 text-slate-500'}
                      `}>
                        {idx + 1}
                      </div>
                      <span className="flex-1 font-medium text-base md:text-lg leading-relaxed">{option}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-auto pt-4 border-t border-slate-100 pb-2">
              <button
                disabled={isSubmitting}
                onClick={nextQuestion}
                className={`w-full font-bold text-base md:text-lg py-3.5 md:py-4 rounded-xl flex justify-center items-center space-x-2 transition-all shadow-md shadow-slate-200/50
                  ${isSubmitting
                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    : 'bg-slate-900 text-white hover:bg-slate-800 active:scale-[0.98]'
                  }
                `}
              >
                <span>{isSubmitting ? '채점 중...' : (currentQuestionIndex < totalQuestions - 1 ? '다음 문제' : '제출 및 채점하기')}</span>
              </button>
            </div>
          </div>
        )}

        {/* RESULTS STATE */}
        {appState === 'results' && (() => {
          // Group questions and answers by subject
          const subjectStats: Record<string, { total: number; correct: number }> = {};
          questions.forEach(q => {
            const subject = q.subject || '공통';
            if (!subjectStats[subject]) {
              subjectStats[subject] = { total: 0, correct: 0 };
            }
            subjectStats[subject].total += 1;
            if (userAnswers[q.id]?.isCorrect) {
              subjectStats[subject].correct += 1;
            }
          });

          const totalCorrect = questions.filter(q => userAnswers[q.id]?.isCorrect).length;
          const averageScore = Math.round((totalCorrect / questions.length) * 100);
          
          const subjectResults = Object.entries(subjectStats).map(([name, stats]) => ({
            name,
            score: Math.round((stats.correct / stats.total) * 100),
            ...stats
          }));

          const hasFail = subjectResults.some(r => r.score < 40);
          const isPass = averageScore >= 60 && !hasFail;

          return (
            <div className="flex-1 flex flex-col p-6 md:p-8 overflow-y-auto">
              <div className="text-center mb-10">
                <div className={`inline-flex items-center justify-center w-24 h-24 rounded-full mb-4 shadow-lg border-4 ${isPass ? 'bg-green-100 border-green-500 text-green-700' : 'bg-red-100 border-red-500 text-red-700'}`}>
                  <span className="text-3xl font-black">
                    {averageScore}<span className="text-sm font-bold">점</span>
                  </span>
                </div>
                <h2 className={`text-2xl font-bold ${isPass ? 'text-green-700' : 'text-red-700'} mb-1`}>
                  {isPass ? '합격입니다! 🎉' : '불합격입니다... 😥'}
                </h2>
                <div className="text-slate-500 text-sm flex flex-col items-center">
                  <span>총 {questions.length}문제 중 {totalCorrect}문제를 맞혔습니다.</span>
                  {!isPass && (
                    <span className="text-red-500 font-medium mt-1">
                      {averageScore < 60 ? '• 평균 점수가 60점 미만입니다.' : ''}
                      {hasFail ? ' • 40점 이하인 과락 과목이 존재합니다.' : ''}
                    </span>
                  )}
                </div>
              </div>

              {/* Subject Breakdown */}
              <div className="mb-10">
                <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center">
                  <BarChart className="w-5 h-5 mr-2 text-blue-600" />
                  과목별 성적 분석
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {subjectResults.map((res, idx) => (
                    <div key={idx} className={`p-4 rounded-xl border ${res.score < 40 ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm font-bold text-slate-700 truncate mr-2" title={res.name}>{res.name}</span>
                        <span className={`text-xs font-black px-2 py-0.5 rounded ${res.score < 40 ? 'bg-red-200 text-red-800' : 'bg-blue-100 text-blue-700'}`}>
                          {res.score}점
                        </span>
                      </div>
                      <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                        <div 
                          className={`h-full transition-all duration-1000 ${res.score < 40 ? 'bg-red-500' : 'bg-blue-600'}`}
                          style={{ width: `${res.score}%` }}
                        ></div>
                      </div>
                      <div className="mt-1 text-[10px] text-slate-500 text-right">
                        {res.correct} / {res.total} 문제 정답
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-6">
                <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center">
                  <CheckCircle2 className="w-5 h-5 mr-2 text-orange-500" />
                  상세 풀이 및 복습
                </h3>
                {questions.map((q, i) => {
                  const answer = userAnswers[q.id];
                  const isCorrect = answer?.isCorrect;
                  
                  return (
                    <div key={q.id} className={`p-6 rounded-2xl border-2 ${isCorrect ? 'border-green-100 bg-green-50/30' : 'border-red-100 bg-red-50/30'}`}>
                      <div className="flex items-start justify-between mb-2">
                        <span className="text-[10px] font-bold bg-slate-200 text-slate-600 px-2 py-0.5 rounded">
                          {q.subject}
                        </span>
                      </div>
                      <div className="flex items-start space-x-3 mb-4">
                        {isCorrect ? (
                          <CheckCircle2 className="w-6 h-6 text-green-500 shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="w-6 h-6 text-red-500 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <h3 className="font-bold text-slate-800 text-lg leading-tight">
                            <span className="text-slate-400 font-medium mr-2">{i + 1}.</span>
                            {q.text}
                          </h3>
                        </div>
                      </div>
                      
                      <div className="space-y-2 pl-9 mb-6">
                        {q.options.map((opt, optIdx) => {
                          const isSelected = answer?.selectedOptionIndex === optIdx;
                          const isActualCorrect = q.correctAnswerIndex === optIdx;
                          
                          let itemStyle = "text-slate-600";
                          if (isActualCorrect) itemStyle = "text-green-700 font-bold bg-green-100/50 px-3 py-1.5 rounded-lg -ml-3";
                          else if (isSelected && !isCorrect) itemStyle = "text-red-600 line-through decoration-red-400";
                          
                          return (
                            <div key={optIdx} className={`flex text-base ${itemStyle}`}>
                              <span className="mr-2">{optIdx + 1}.</span>
                              <span>{opt}</span>
                              {isSelected && !isCorrect && <span className="ml-2 text-xs font-bold text-red-500 bg-red-100 px-1.5 py-0.5 rounded uppercase">내 선택</span>}
                            </div>
                          );
                        })}
                      </div>

                      {!isCorrect && (
                        <div className="pl-9 mt-4">
                          <div className="bg-white border-l-4 border-slate-800 p-4 rounded-xl rounded-l-none shadow-sm text-slate-700 text-sm leading-relaxed">
                            <span className="font-bold text-slate-900 block mb-1">핵심 이유</span>
                            <p>{q.shortExplanation || q.explanation.split('.')[0] + '.'}</p>
                            
                            <button 
                              onClick={() => toggleExplanation(q.id)}
                              className="text-blue-600 font-bold mt-2 hover:text-blue-800 text-xs flex items-center"
                            >
                              {expandedExplanations[q.id] ? '접기' : '자세한 풀이 보기'}
                            </button>
                            
                            {expandedExplanations[q.id] && (
                              <div className="mt-3 pt-3 border-t border-slate-100 text-slate-600">
                                <span className="font-bold text-slate-800 block mb-1">상세 해설</span>
                                {q.explanation}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="mt-10 flex gap-3">
                <button
                  onClick={() => setAppState('setup')}
                  className="flex-1 bg-slate-100 text-slate-700 font-bold py-4 rounded-xl hover:bg-slate-200 transition-all flex justify-center items-center space-x-2"
                >
                  <ChevronRight className="w-5 h-5 rotate-180" />
                  <span>새로운 시험 설정</span>
                </button>
                
                <button
                  onClick={startWrongAnswersExam}
                  disabled={wrongBank.length === 0}
                  className={`flex-1 font-bold py-4 rounded-xl transition-all flex justify-center items-center space-x-2
                    ${wrongBank.length > 0 
                      ? 'bg-slate-900 text-white hover:bg-slate-800 shadow-sm'
                      : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    }
                  `}
                >
                  <RotateCcw className="w-5 h-5" />
                  <span className="hidden sm:inline">틀린 문제 다시 풀기</span>
                  <span className="sm:hidden">다시 풀기</span>
                </button>
              </div>
            </div>
          );
        })()}

        {/* WRONG BANK STATE */}
        {appState === 'wrongBank' && (() => {
          const filteredWrongBank = wrongBank.filter(r => selectedTopicFilter === '전체' || (r.topic || '기타') === selectedTopicFilter);
          
          return (
          <div className="flex-1 flex flex-col p-6 md:p-8">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-2xl font-bold text-slate-800 flex items-center space-x-2">
                <BarChart className="w-6 h-6 text-blue-600" />
                <span>내 오답 노트</span>
              </h2>
              <button 
                onClick={() => setAppState('setup')}
                className="text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors flex items-center"
              >
                돌아가기 <ChevronRight className="w-4 h-4 ml-1" />
              </button>
            </div>

            {wrongBank.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
                <CheckCircle2 className="w-16 h-16 text-slate-300 mb-4" />
                <h3 className="text-xl font-bold text-slate-600 mb-2">저장된 취약점이 없어요!</h3>
                <p className="text-slate-500">완벽하게 이해하셨군요.<br/>계속해서 모의고사를 풀며 실력을 점검해 보세요.</p>
                <button 
                  onClick={() => setAppState('setup')}
                  className="mt-6 px-6 py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-all"
                >
                  모의고사 풀러가기
                </button>
              </div>
            ) : (
              <div className="flex-1 flex flex-col">
                <div className="bg-orange-50 text-orange-800 p-4 rounded-xl mb-6 flex justify-between items-center sm:flex-row flex-col gap-4">
                  <div>
                    <span className="font-bold block text-lg">
                      {selectedTopicFilter === '전체' ? `총 ${wrongBank.length}문제가 누적되었습니다.` : `${selectedTopicFilter} 과목에 ${filteredWrongBank.length}문제가 누적되었습니다.`}
                    </span>
                    <span className="text-sm opacity-80 mt-1 block">이 문제들을 확실히 알고 넘어가는 것이 합격의 지름길입니다.</span>
                  </div>
                  <button 
                    onClick={startWrongAnswersExam}
                    className="w-full sm:w-auto shrink-0 bg-orange-600 text-white px-5 py-2.5 rounded-xl font-medium shadow-sm hover:bg-orange-700 transition-all flex items-center justify-center space-x-2"
                    disabled={filteredWrongBank.length === 0}
                    title={filteredWrongBank.length === 0 ? "해당 과목에 틀린 문제가 없습니다." : ""}
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>누적 오답 풀기</span>
                  </button>
                </div>

                <div className="mb-6 flex flex-wrap gap-2">
                  {(() => {
                    const topics = ['전체', ...Array.from(new Set(wrongBank.map(r => r.topic || '기타')))];
                    return topics.map(t => (
                      <button
                        key={t}
                        onClick={() => setSelectedTopicFilter(t)}
                        className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                          selectedTopicFilter === t 
                            ? 'bg-slate-800 text-white shadow-sm'
                            : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {t}
                      </button>
                    ));
                  })()}
                </div>

                {filteredWrongBank.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-slate-500 bg-slate-50 rounded-xl p-8">
                    해당 조건에 해당하는 문제가 없습니다.
                  </div>
                ) : (
                  <div className="space-y-4 overflow-y-auto flex-1 pb-10">
                    {filteredWrongBank.map((record, i) => (
                    <div key={record.question.id} className="p-5 bg-white border border-slate-200 rounded-xl shadow-sm">
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold bg-slate-100 text-slate-500 px-2 py-1 rounded">
                            {new Date(record.failedAt).toLocaleDateString()}
                          </span>
                          {(record.correctCount || 0) > 0 && (
                            <span className="text-xs font-bold bg-green-100 text-green-700 px-2 py-1 rounded">
                              연속 정답: {record.correctCount}/2
                            </span>
                          )}
                        </div>
                        {record.id && record.question.id && (
                          <button
                            onClick={() => setRecordToDelete({recordId: record.id!, questionId: record.question.id})}
                            className="text-slate-400 hover:text-red-500 hover:bg-red-50 p-1.5 rounded-md transition-all"
                            title="오답 노트에서 이 문제 삭제"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                          {record.question.subject}
                        </span>
                      </div>
                      <h3 className="font-bold text-slate-800 text-lg mb-3">
                        <span className="text-blue-600 mr-2">Q.</span>
                        {record.question.text}
                      </h3>
                      <div className="space-y-1.5 pl-6 mb-4">
                        {record.question.options.map((opt, optIdx) => {
                          const isCorrect = record.question.correctAnswerIndex === optIdx;
                          return (
                            <div key={optIdx} className={`text-sm ${isCorrect ? 'font-bold text-green-700 bg-green-50 p-1.5 rounded -ml-1.5' : 'text-slate-500'}`}>
                              {optIdx + 1}. {opt}
                            </div>
                          );
                        })}
                      </div>
                      <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-xl text-sm text-slate-700 mt-2">
                        <span className="font-bold text-slate-900 mb-1 block">핵심 이유</span>
                        <p>{record.question.shortExplanation || record.question.explanation.split('.')[0] + '.'}</p>
                        
                        <button 
                          onClick={() => toggleExplanation(record.question.id)}
                          className="text-blue-600 font-bold mt-2 hover:text-blue-800 text-xs flex items-center"
                        >
                          {expandedExplanations[record.question.id] ? '접기' : '자세한 풀이 보기'}
                        </button>
                        
                        {expandedExplanations[record.question.id] && (
                          <div className="mt-3 pt-3 border-t border-slate-200 text-slate-600">
                            <span className="font-bold text-slate-800 block mb-1">상세 해설</span>
                            {record.question.explanation}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  </div>
                )}
              </div>
            )}
          </div>
          );
        })()}

        {toastMessage && (
          <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-slate-800 text-white px-6 py-3 rounded-full shadow-2xl z-50 animate-in fade-in slide-in-from-bottom-4 duration-300 text-sm font-medium flex items-center shadow-slate-800/20">
            {toastMessage}
          </div>
        )}

        {recordToDelete && (
          <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
              <h3 className="text-lg font-bold text-slate-800 mb-2">오답 문제 삭제</h3>
              <p className="text-sm text-slate-600 mb-6">정말 삭제하시겠습니까? 삭제된 문제는 복구할 수 없습니다.</p>
              <div className="flex space-x-3">
                <button
                  onClick={() => setRecordToDelete(null)}
                  className="flex-1 py-2.5 bg-slate-100 text-slate-700 font-medium rounded-xl hover:bg-slate-200 transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={() => {
                    deleteWrongBankRecord(recordToDelete.recordId, recordToDelete.questionId);
                    setRecordToDelete(null);
                  }}
                  className="flex-1 py-2.5 bg-red-600 text-white font-medium rounded-xl hover:bg-red-700 transition-colors"
                >
                  삭제
                </button>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
