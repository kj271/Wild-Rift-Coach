import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { useModelStorage } from "@/hooks/use-model-storage";
import { GameContext, useCreateOpenrouterConversation, useListOpenrouterConversations, useGetOpenrouterConversation, getGetOpenrouterConversationQueryKey, getListOpenrouterConversationsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Target, ShieldAlert, Crosshair, Map, Upload, MessageSquare, ChevronDown, Settings, AlertCircle, Loader2, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export default function CoachPage() {
  const queryClient = useQueryClient();
  const [model] = useModelStorage();
  
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [context, setContext] = useState<GameContext>({
    gameTime: "",
    myLocation: "",
    myRole: "",
    allyChampions: "",
    enemyChampions: "",
    dragonStatus: "",
    baronStatus: "",
    riftHeraldStatus: "",
    goldDiff: "",
    score: "",
    additionalNotes: "",
  });

  const [advice, setAdvice] = useState<string>("");
  const [isAdvising, setIsAdvising] = useState(false);
  const [isContextOpen, setIsContextOpen] = useState(false);
  
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [isChatting, setIsChatting] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const { data: conversations } = useListOpenrouterConversations();
  const { data: conversationData } = useGetOpenrouterConversation(activeConversationId as number, {
    query: {
      enabled: !!activeConversationId,
      queryKey: getGetOpenrouterConversationQueryKey(activeConversationId as number)
    }
  });

  const createConversation = useCreateOpenrouterConversation();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      if (result) {
        setImageBase64(result);
      }
    };
    reader.readAsDataURL(file);
  };

  const updateContext = (key: keyof GameContext, value: string) => {
    setContext(prev => ({ ...prev, [key]: value }));
  };

  const startNewConversation = async () => {
    if (!model) return null;
    try {
      const conv = await createConversation.mutateAsync({
        data: {
          title: `Game at ${new Date().toLocaleTimeString()}`,
          model
        }
      });
      setActiveConversationId(conv.id);
      queryClient.invalidateQueries({ queryKey: getListOpenrouterConversationsQueryKey() });
      return conv.id;
    } catch (err) {
      console.error("Failed to create conversation", err);
      return null;
    }
  };

  const getAdvice = async () => {
    if (!model) return;
    
    setIsAdvising(true);
    setAdvice("");
    
    try {
      const BASE = import.meta.env.BASE_URL;
      
      const payloadContext = Object.fromEntries(
        Object.entries(context).map(([k, v]) => [k, v || null])
      ) as GameContext;

      const base64Data = imageBase64?.split(',')[1] || null;

      const res = await fetch(`${BASE}api/coach/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          imageBase64: base64Data,
          context: payloadContext
        }),
      });
      
      if (!res.ok) {
        throw new Error("Failed to get advice");
      }
      
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6).trim();
            if (!dataStr) continue;
            try {
              const data = JSON.parse(dataStr);
              if (data.content) {
                setAdvice(prev => prev + data.content);
              }
              if (data.done) {
                // Once done, ensure we have an active conversation ready for follow-ups
                if (!activeConversationId) {
                  await startNewConversation();
                }
                break;
              }
            } catch (e) {
              console.error("Failed to parse SSE JSON", e);
            }
          }
        }
      }
    } catch (err) {
      console.error(err);
      setAdvice("Error getting advice. Please try again.");
    } finally {
      setIsAdvising(false);
    }
  };

  const sendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !model || !activeConversationId) return;

    const currentMsg = chatInput;
    setChatInput("");
    setIsChatting(true);

    try {
      const BASE = import.meta.env.BASE_URL;
      const payloadContext = Object.fromEntries(
        Object.entries(context).map(([k, v]) => [k, v || null])
      ) as GameContext;

      const res = await fetch(`${BASE}api/openrouter/conversations/${activeConversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: currentMsg,
          model,
          context: payloadContext
        }),
      });

      if (!res.ok) throw new Error("Failed to send message");

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      
      // We could optimistically add the user message, then stream the response
      // For simplicity, we just trigger a refetch of the conversation data once done
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
      }

      queryClient.invalidateQueries({ queryKey: getGetOpenrouterConversationQueryKey(activeConversationId) });
    } catch (err) {
      console.error("Chat error:", err);
    } finally {
      setIsChatting(false);
      setTimeout(() => {
        chatScrollRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center">
      <header className="w-full border-b border-border/50 bg-background/80 backdrop-blur-md sticky top-0 z-10">
        <div className="w-full max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-primary/20 flex items-center justify-center border border-primary/50">
              <Crosshair className="w-5 h-5 text-primary" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white">MACRO<span className="text-primary">COACH</span></h1>
          </div>
          <Link href="/settings">
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-white">
              <Settings className="w-5 h-5" />
            </Button>
          </Link>
        </div>
      </header>

      <main className="w-full max-w-4xl p-4 md:p-6 space-y-6 flex-1">
        {!model && (
          <div className="bg-destructive/10 border border-destructive/20 text-destructive p-4 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold">Model not configured</h3>
              <p className="text-sm mt-1 opacity-90">Please select an AI model in settings before requesting advice.</p>
              <Link href="/settings">
                <Button variant="outline" size="sm" className="mt-3 bg-background hover:bg-background/80 border-destructive/30 text-destructive">
                  Go to Settings
                </Button>
              </Link>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          <div className="md:col-span-5 lg:col-span-4 space-y-6">
            <Card className="border-border bg-card/40 backdrop-blur-sm overflow-hidden group">
              <div 
                className="aspect-video bg-black/60 relative flex flex-col items-center justify-center border-b border-border/50 cursor-pointer hover:bg-black/80 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                {imageBase64 ? (
                  <img src={imageBase64} alt="Game screenshot" className="absolute inset-0 w-full h-full object-cover opacity-60" />
                ) : null}
                
                <div className="relative z-10 flex flex-col items-center p-4 text-center">
                  <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center mb-3 text-primary shadow-[0_0_15px_rgba(var(--primary),0.3)]">
                    <Upload className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-medium text-white shadow-black drop-shadow-md">Upload Game Screenshot</p>
                  <p className="text-xs text-muted-foreground mt-1">Tap to select or take a photo</p>
                </div>
                <input 
                  type="file" 
                  accept="image/*" 
                  className="hidden" 
                  ref={fileInputRef}
                  onChange={handleFileChange}
                />
              </div>
            </Card>

            <Collapsible 
              open={isContextOpen} 
              onOpenChange={setIsContextOpen}
              className="border border-border rounded-lg bg-card/40 backdrop-blur-sm"
            >
              <CollapsibleTrigger asChild>
                <Button variant="ghost" className="w-full justify-between h-12 px-4 rounded-none border-b border-transparent data-[state=open]:border-border/50">
                  <span className="flex items-center gap-2 font-medium">
                    <Map className="w-4 h-4 text-primary" />
                    Manual Context
                  </span>
                  <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-200", isContextOpen && "rotate-180")} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="p-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="gameTime" className="text-xs text-muted-foreground">Game Time</Label>
                    <Input id="gameTime" placeholder="e.g. 12:45" className="h-8 text-sm bg-black/40" value={context.gameTime || ""} onChange={e => updateContext("gameTime", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="myRole" className="text-xs text-muted-foreground">My Role</Label>
                    <Select value={context.myRole || ""} onValueChange={v => updateContext("myRole", v)}>
                      <SelectTrigger id="myRole" className="h-8 text-sm bg-black/40">
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Top">Baron (Top)</SelectItem>
                        <SelectItem value="Jungle">Jungle</SelectItem>
                        <SelectItem value="Mid">Mid</SelectItem>
                        <SelectItem value="ADC">Dragon (ADC)</SelectItem>
                        <SelectItem value="Support">Support</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="myLocation" className="text-xs text-muted-foreground">My Location</Label>
                  <Input id="myLocation" placeholder="e.g. Near Dragon Pit" className="h-8 text-sm bg-black/40" value={context.myLocation || ""} onChange={e => updateContext("myLocation", e.target.value)} />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="allyChampions" className="text-xs text-muted-foreground">Ally Champions</Label>
                  <Input id="allyChampions" placeholder="e.g. Ahri, Jinx, Nami" className="h-8 text-sm bg-black/40" value={context.allyChampions || ""} onChange={e => updateContext("allyChampions", e.target.value)} />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="enemyChampions" className="text-xs text-muted-foreground">Enemy Champions</Label>
                  <Input id="enemyChampions" placeholder="e.g. Yasuo, Lee Sin" className="h-8 text-sm bg-black/40" value={context.enemyChampions || ""} onChange={e => updateContext("enemyChampions", e.target.value)} />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="goldDiff" className="text-xs text-muted-foreground">Gold Diff</Label>
                    <Input id="goldDiff" placeholder="e.g. +2k" className="h-8 text-sm bg-black/40" value={context.goldDiff || ""} onChange={e => updateContext("goldDiff", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="score" className="text-xs text-muted-foreground">Kill Score</Label>
                    <Input id="score" placeholder="e.g. 12-8" className="h-8 text-sm bg-black/40" value={context.score || ""} onChange={e => updateContext("score", e.target.value)} />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="additionalNotes" className="text-xs text-muted-foreground">Notes</Label>
                  <Textarea id="additionalNotes" placeholder="Any extra context..." className="min-h-16 text-sm bg-black/40 resize-none" value={context.additionalNotes || ""} onChange={e => updateContext("additionalNotes", e.target.value)} />
                </div>
              </CollapsibleContent>
            </Collapsible>
            
            {conversations && conversations.length > 0 && (
              <Card className="border-border bg-card/40 backdrop-blur-sm">
                <CardHeader className="py-3 px-4 border-b border-border/50">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-primary" />
                    Past Sessions
                  </CardTitle>
                </CardHeader>
                <div className="flex flex-col max-h-48 overflow-y-auto p-2 gap-1">
                  {conversations.map(conv => (
                    <Button 
                      key={conv.id} 
                      variant="ghost" 
                      size="sm" 
                      className={cn("justify-start text-xs font-normal", activeConversationId === conv.id && "bg-primary/10 text-primary")}
                      onClick={() => setActiveConversationId(conv.id)}
                    >
                      {conv.title}
                    </Button>
                  ))}
                </div>
              </Card>
            )}
          </div>

          <div className="md:col-span-7 lg:col-span-8 flex flex-col gap-6">
            <Button 
              size="lg" 
              className="w-full h-16 text-lg font-bold shadow-[0_0_30px_rgba(var(--primary),0.2)] hover:shadow-[0_0_40px_rgba(var(--primary),0.4)] transition-all bg-primary text-primary-foreground uppercase tracking-widest relative overflow-hidden shrink-0"
              onClick={getAdvice}
              disabled={!model || isAdvising || (!imageBase64 && !context.gameTime && !context.myRole && !context.additionalNotes)}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-[100%] animate-[shimmer_2s_infinite]" />
              {isAdvising ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Analyzing State...
                </>
              ) : (
                <>
                  <Target className="w-5 h-5 mr-2" />
                  Advise Me
                </>
              )}
            </Button>

            {(advice || isAdvising) && (
              <Card className="border-primary/30 bg-card/80 backdrop-blur-md shadow-2xl flex flex-col relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary/50 via-primary to-primary/50" />
                <CardHeader className="pb-3 border-b border-border/50 bg-black/20">
                  <CardTitle className="text-lg flex items-center gap-2 text-primary font-display tracking-wide uppercase">
                    <ShieldAlert className="w-5 h-5" />
                    Tactical Read
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="p-4 md:p-6 prose prose-invert prose-primary max-w-none">
                    {advice ? (
                      <div className="whitespace-pre-wrap font-sans leading-relaxed text-slate-300">
                        {advice}
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <Skeleton className="h-4 w-3/4 bg-primary/10" />
                        <Skeleton className="h-4 w-full bg-primary/10" />
                        <Skeleton className="h-4 w-5/6 bg-primary/10" />
                        <Skeleton className="h-4 w-1/2 bg-primary/10" />
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Chat Panel */}
            {activeConversationId && (
              <Card className="border-border bg-card/40 backdrop-blur-md shadow-xl flex flex-col flex-1 overflow-hidden min-h-[300px]">
                <CardHeader className="pb-3 border-b border-border/50 bg-black/20">
                  <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground uppercase tracking-wider font-semibold">
                    <MessageSquare className="w-4 h-4" />
                    Follow-up Questions
                  </CardTitle>
                </CardHeader>
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {conversationData?.messages.map((msg, i) => (
                    <div key={msg.id || i} className={cn("flex flex-col max-w-[85%]", msg.role === 'user' ? "ml-auto items-end" : "mr-auto items-start")}>
                      <div className={cn("px-4 py-2 rounded-lg text-sm whitespace-pre-wrap", 
                        msg.role === 'user' ? "bg-primary text-primary-foreground rounded-tr-none" : "bg-muted text-foreground rounded-tl-none border border-border"
                      )}>
                        {msg.content}
                      </div>
                    </div>
                  ))}
                  {isChatting && (
                    <div className="flex flex-col max-w-[85%] mr-auto items-start">
                      <div className="px-4 py-3 rounded-lg bg-muted text-foreground rounded-tl-none border border-border flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">Thinking...</span>
                      </div>
                    </div>
                  )}
                  <div ref={chatScrollRef} />
                </div>
                <div className="p-3 border-t border-border/50 bg-black/20">
                  <form onSubmit={sendChatMessage} className="flex items-center gap-2">
                    <Input 
                      placeholder="Ask about the analysis..." 
                      className="bg-black/40 border-border/50 focus-visible:ring-primary/50"
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      disabled={isChatting}
                    />
                    <Button type="submit" size="icon" className="shrink-0" disabled={!chatInput.trim() || isChatting}>
                      <Send className="w-4 h-4" />
                    </Button>
                  </form>
                </div>
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
