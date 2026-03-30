# StoryGPT-V: Large Language Models as Consistent Story Visualizers

Xiaoqian Shen KAUST

xiaoqian.shen@kaust.edu.sa

Mohamed Elhoseiny KAUST

mohamed.elhoseiny@kaust.edu.sa

# Abstract

Recent generative models have demonstrated impressive capabilities in generating realistic and visually pleasing images grounded on textual prompts. Nevertheless, a significant challenge remains in applying these models for the more intricate task of story visualization. Since it requires resolving pronouns (he, she, they) in the frame descriptions, i.e., anaphora resolution, and ensuring consistent characters and background synthesis across frames. Yet, the emerging Large Language Model (LLM) showcases robust reasoning abilities to navigate through ambiguous references and process extensive sequences. Therefore, we introduce StoryGPT-V, which leverages the merits of the latent diffusion (LDM) and LLM to produce images with consistent and high-quality characters grounded on given story descriptions. First, we train a character-aware LDM, which takes character-augmented semantic embedding as input and includes the supervision of the cross-attention map using character segmentation masks, aiming to enhance character generation accuracy and faithfulness. In the second stage, we enable an alignment between the output of LLM and the character-augmented embedding residing in the input space of the first-stage model. This harnesses the reasoning ability of LLM to address ambiguous references and the comprehension capability to memorize the context. We conduct comprehensive experiments on two visual story visualization benchmarks. Our model reports superior quantitative results and consistently generates accurate characters of remarkable quality with low memory consumption. Our code will be made publicly available<sup>1</sup>.

# 1. Introduction

Image generation algorithms have made significant strides and are on the verge of matching human-level proficiency. Despite this progress, even a powerful image generator suffers from story visualization task, which involves generating a series of frames that maintain semantic coherence

![](images/365375d13bd26feec2f86c4ea77396ea5c30195f6ccf95f7583ed2fdd0577791.jpg)  
Figure 1. We present StoryGPT-V, which empowers a large language model for interleaved image-text comprehension and aligns its output with character-aware Latent Diffusion (Char-LDM) for autoregressive story visualization grounded on co-referential text descriptions.

based on narrative descriptions [22, 27, 28, 56]. This challenge arises from the fact that captions for a single image are typically self-sufficient, lacking the continuity needed to capture the narrative of object interactions that unfold through multiple sentences over a sequence of frames. This poses a promising avenue for further research and exploration of story visualization. Such a task demands a model capable of producing high-quality characters and detailed environmental objects grounded on given text descriptions. Moreover, it requires the ability to disambiguate referential pronouns in the subsequent frame descriptions, e.g., "she, he, they".

Prior studies [4, 22, 26, 28, 47] explore the realm of story visualization but do not take reference resolution [44] (i.e., anaphora resolution in the context of natural language processing [2, 29]) into consideration. Story-LDM [38] first extended story visualization benchmarks with referential text and devises an attention memory module that retains visual context throughout the series of generated frames. However, it still struggles to generate precise characters for referential text since the interaction between current descriptions and contextual information occurs within the CLIP [36] se

mantic space, causing a loss in fine-grained language understanding and hindering referencing capabilities. Furthermore, the attention memory module requires maintaining all previous images in latent pixel space for attention calculations, significantly increasing memory demands with each additional frame in autoregressive generation.

The limitation of previous works leads us to rethink how to achieve accurate and efficient reference resolution toward consistent story visualization. Large Language Models (LLMs) [3, 34, 37, 58], trained on extensive text corpora, have exhibited impressive capabilities in deciphering contextual references in natural language descriptions. Prior works [11, 18] have demonstrated the effectiveness of harnessing LLMs for tasks involving image comprehension and generation, where the visual features are adapted within LLM's token space rather than the pixel space. Hence, such a model could be utilized to efficiently address ambiguous references for story visualization tasks.

In this work, we aim at story visualization grounded on given co-referential frame descriptions, focusing on delivering high-quality and coherent portrayals of characters. To achieve this, we leverage a powerful text-to-image model [41] to generate high-quality characters and environmental objects grounded on given frame descriptions, coupled with the reasoning ability of Large Language Models (LLMs) to resolve ambiguous references and improve the cohesiveness of the context. To improve the generation of highly faithful characters, we enhance the pre-trained Latent Diffusion (LDM) towards character-aware training in the first stage. We first augment the token feature by incorporating the visual representation of the corresponding character. Additionally, we regulate the cross-attention map of the character token to highlight the interaction between the conditional token and specific latent pixels.

In addressing the challenge of ambiguous reference, which cannot be effectively handled by a robust text-to-image model alone, we leverage an LLM that takes interleaved images and co-referential frame descriptions as input, and aligns its visual output with the character-augmented embedding encoded by first-stage model. Such semantic guidance, along with LLM's casual modeling, enables effective reference resolution and consistent generation. Furthermore, our approach efficiently preserves context by processing images as sequences of tokens in the LLM input space with low memory consumption.

# Contributions. Our contributions are as follows:

- We first enhance the text representation by integrating the visual features of the corresponding characters, then refine a character-aware LDM for better character generation by directing cross-attention maps with character segmentation mask guidance.   
- We adapt LLM by interlacing text and image inputs, empowering it to implicitly deduce references from previ

ous contexts and produce visual responses that align with the input space of the first-stage Char-LDM. This leverages the LLM's reasoning capacity for reference resolution and the synthesis of coherent characters and scenes.

- Our model is capable of visualizing stories featuring precise and coherent characters and backgrounds on story visualization benchmarks. Furthermore, we showcase the model's proficiency in producing extensive (longer than 40 frames) visual stories with low memory consumption.

# 2. Related Work

Text-to-image synthesis. Numerous works [8-10] have demonstrated unprecedented performance on semantic generation. Recently, diffusion-based text-to-image models [39-41, 43] have shown significant advancements in enhancing image quality and diversity through the utilization of diffusion models. However, these text-to-image approaches primarily concentrate on aligning individual-generated images grounded on text descriptions and do not take into account the crucial aspects of character and scene consistency across multiple frames in the story visualization task. Additionally, they lack the capability to effectively resolve co-reference issues within a narrative description.

Multi-modal Large Language Models. Large Language Models (LLMs) wield an extensive repository of human knowledge and exhibit impressive reasoning capabilities. Recent studies [1, 5, 21, 49] utilize pre-trained language models to tackle vision-language tasks, and subsequent studies [6, 16, 20, 52, 59, 60] further enhance multi-modal abilities by aligning vision models with LLM input space. In addition to multi-modal comprehension, several works are dedicated to more challenging multi-modal generation tasks. FROMAGe [19] appends a special retrieval token to LLM and maps the hidden representation of this token into a vector space for retrieving images. Several current works [18, 54, 57] learn a mapping from hidden embeddings of an LLM represents for additional visual outputs into the input space of a frozen pre-trained text-to-image generation model [41]. In this work, we fed multi-modal LLM with interleaved image and referential text descriptions as input and aligned the output with a character-aware fused embedding from our first-stage Char-LDM, guiding the LLM in implicitly deducing the references.

Story Visualization. StoryGAN [22] pioneers the story generation task, which proposes a sequential conditional GAN framework with dual frame and story level discriminators to improve image quality and narrative coherence. DuCoStoryGAN [27] introduces a dual-learning framework that utilizes video captioning to enhance semantic alignment between descriptions and generated images. VLCStoryGAN [26] used video captioning for semantic alignment between text and frames. Recently, StoryDALL-E [28] retrofits the cross-attention layers of the pre-trained text

to-image model to promote generalizability to unseen visual attributes of the generated story. These methods do not consider ambiguous references in text descriptions. Story-LDM [38] first introduced reference resolution in story visualization tasks and proposed an autoregressive diffusion-based framework with a memory-attention module to resolve ambiguous references. Nevertheless, it struggled with accurately resolving references and was memory-intensive, as it required retaining all previous context in pixel space. In our work, we employ a powerful causal inference LLM for reference resolution, and it efficiently maintains context by mapping visual features into several token embeddings as LLM inputs rather than operating in latent pixel space.

# 3. Methods

The objective of story visualization is to transform a textual narrative, composed of a series of $N$ descriptions $S_{1},\ldots ,S_{N}$ , into a sequence of corresponding visual frames $I_{1},\ldots ,I_{N}$ that illustrate the story. We've developed a two-stage method aimed at generating temporally consistent visual stories with accurate and high-quality characters. First, we augment text representation with characters' visual features and refine a character-aware LDM [41] (Char-LDM) towards high-quality character generation. This is achieved by directing the cross-attention maps of specific tokens associated with the corresponding characters, using character segmentation mask supervision (Section 3.2). Then, we leverage the reasoning ability of LLM to resolve ambiguous references by aligning the output of LLM with Char-LDM input space for temporal consistent story visualization (Section 3.3).

# 3.1. Preliminaries

Cross-attention in text-conditioned Diffusion Models. In diffusion models [15, 46], each diffusion step $t$ involves predicting noise $\epsilon$ from the noise code $z_{t} \in \mathbb{R}^{(h \times w) \times d_{v}}$ conditioned on text embedding $\psi(S) \in \mathbb{R}^{L \times d_{c}}$ via U-shaped Network [42], where $\psi$ is the text encoder, $h$ and $w$ are the latent spatial dimensions and $L$ is the sequence length. Within U-Net, the cross-attention layer accepts the spatial latent code $z$ and the text embeddings $\psi(S)$ as inputs, then projects them into $Q = W^{q}z$ , $K = W^{k}\psi(S)$ and $V = W^{v}\psi(S)$ , where $W^{q} \in \mathbb{R}^{d_{v} \times d'}$ , $W^{k}$ , $W^{v} \in \mathbb{R}^{d_{c} \times d'}$ . The attention scores is computed as $A = \mathrm{Softmax}\left(\frac{QK^T}{\sqrt{d'}}\right) \in \mathbb{R}^{(h \times w) \times L}$ , where $A[i,j,k]$ represents the attention of $k$ -th text token to the $(i,j)$ latent pixel. In this context, each entry $A[i,j,k]$ within the cross-attention map $A$ quantifies the magnitude of information propagation from the $k$ -th text token to the latent pixel at position $(i,j)$ . This feature of the interaction between semantic representation and latent pixels is harnessed in various tasks such as image editing [13, 32], video editing [24], and fast adapta

tion [7, 45, 53, 55].

# 3.2. Character-aware LDM with attention control

Integrate visual features with text conditions. To achieve accurate and high-quality characters in story visualization, we augment text descriptions with visual features of corresponding characters and guide the attention of text conditions to focus more on corresponding character synthesis. Given a text description $S$ , suppose there are $K$ characters that should be generated in image $I$ , images of those characters $\{I_c^1,\dots,I_c^K\}$ , a list of token indices indicating each character name located in the description, denoted as $\{i_c^1,\dots,i_c^K\}$ . Inspired by [25, 53, 55], we first utilize CLIP [36] text encoder $\psi$ and image encoder $\phi$ to obtain text embedding and visual features of the characters appear in the image respectively. Then, we augment the text embedding if the token represents a character name. More specifically, we concatenate the token embedding and the visual features of the corresponding character and feed them into an MLP to obtain the augmented text embedding. Each augmented token embedding in the augmented embedding $c$ is formulated as below:

$$
c ^ {k} = \operatorname {M L P} \left(\operatorname {c o n c a t} \left(\left(\psi \left(S \left[ i _ {c} ^ {k} \right]\right), \phi \left(I _ {c} ^ {k}\right)\right)\right) \right. \tag {1}
$$

where $i_c^k$ refers to the index of the text token for character $k$ , and $I_c^k$ the image corresponding to character $k$ . The embeddings for tokens in $c$ that are unrelated to the character remain identical to the vanilla CLIP token embeddings. The enhanced embedding $c$ is then employed as supervision for the second-stage training, which will be further detailed in Section 3.3, where $c_1, \ldots, c_N$ are the corresponding augmented embeddings for $S_1, \ldots, S_N$ .

Controlling attention of text tokens. Previous work [13] has demonstrated that the visual characteristics of generated images are influenced by the intricate interplay between latent pixels and text embedding through the diffusion process of LDM [41]. However, in vanilla LDM [41], a single latent pixel can unrestrictedly engage with all text tokens. Therefore, we introduce a constraint to refine this behavior and strengthen the impact of the token representing the character's name on certain pixels in the denoising process, as illustrated in Figure 2 (a). First, we obtain an offline segmentation mask of corresponding characters denoted as $\{M_1,\dots M_K\}$ as supervision signals via SAM [17]. We then encourage the cross-attention map $A_{k}$ for each character $k$ at the token index position $i_c^k$ , to align with the binary segmentation mask $M_{k}$ , whereas diverging from irrelevant regions $\bar{M}_k$ , formulated as follows:

$$
\mathcal {L} _ {\text {r e g}} = \frac {1}{K} \sum_ {k = 1} ^ {K} \left(A _ {k} ^ {-} - A _ {k} ^ {+}\right) \tag {2}
$$

![](images/28667f2876f9299feb64572bf13bc853eb1e491411985cad1e7e4cbce9bc6dcf.jpg)  
(a) Stage-1: Char-LDM with cross-attention control

![](images/4d37f1350c87699f08212c0447cfdb25ffb0975bc5991bf5ad3494d7c95d1837.jpg)  
(b) Stage-2: Aligning LLM for reference resolution   
Figure 2. (a) In the first stage, a fused embedding is created by integrating character visuals with text embeddings, serving as the Char-LDM's conditional input, and the cross-attention maps of Char-LDM will be guided by corresponding character segmentation mask for accurate and high-quality character generation (Section 3.2). (b) In the second stage, the LLM takes the interleaved image and text context as input and generates $R$ [IMG] tokens. These tokens are then projected by LDM Mapper into an intermediate output, which will be encouraged to align with fused embedding as Char-LDM's input. The figure intuitively shows how the character-augmented fused embedding and the casual language modeling aid LLM for reference resolution (Section 3.3).

where

$$
A _ {k} ^ {-} = \frac {A _ {k} \odot \bar {M} _ {k}}{\sum_ {i , j} (\bar {M} _ {k}) _ {i j}}, A _ {k} ^ {+} = \frac {A _ {k} \odot M _ {k}}{\sum_ {i , j} (M _ {k}) _ {i j}} \tag {3}
$$

where $K$ is the number of characters to be generated in the image, $i_c^k$ is the index of text token representing character $k$ and $\odot$ is the Hadamard product. By reducing the loss, it increases the attention of character tokens to the relevant pixels of their respective characters, while reducing their attention to irrelevant areas. Moreover, as the token embeddings are enriched with the visual features of the corresponding character, this attention control serves to deepen the connection between the augmented semantic space and latent pixel denoising, which can consequently enhance the quality of synthesized characters.

Our first stage Char-LDM focuses solely on the quality of image generation grounded on a single caption. Yet, there remain challenges that surpass the abilities of text-to-image generators in visualizing a sequence of stories. Firstly, story visualization demands character and background consistency, an aspect not covered by our first-stage enhancements. Moreover, the inherent nature of lengthy descriptions includes referential terms like he, she, or they, which presents a significant challenge for LDM in achiev-

ing accurate inference. In contrast, LLMs can adeptly infer the intended character to which the ambiguous text refers. Therefore, to address this issue, we harness the formidable reasoning capabilities of LLM to disambiguate such references.

# 3.3. Aligning LLM for reference resolution

To enable an LLM to autoregressively generate images conditioned on prior context and resolve ambiguous references, the model must be capable of (i) processing images; (ii) producing images; and (iii) implicitly deducing the subject of reference. The model could understand the image by learning a linear mapping from the visual feature to the LLM input space, and generate images by aligning the hidden states with conditional input required by LDM, which is the fused embedding encoded by first-stage Char-LDM's text and visual encoder. It integrates the visual features of characters into the text embedding. This character-augmented embedding, along with the causal language modeling (CLM) [33, 34, 50] will direct the LLM to implicitly deduce and generate the correct character for the referential input, as depicted in Figure 2 (b).

More specifically, the LLM input consists of interleaved co-referential text descriptions and story

frames with flexible frame length $n$ , in the order of $(I_1, S_1, \dots, I_{n-1}, S_{n-1}, S_n)$ , where $2 \leq n \leq N$ . We first extract visual embeddings $\phi(I_i) \in \mathbb{R}^{d_i}$ with CLIP [36] visual backbone, where $i \in [2, n]$ , and learn $\text{Mapper}_{LLM}$ with trainable matrix $\mathbf{W}_{v2t} \in \mathbb{R}^{d_i \times m_e}$ which maps $\phi(I_i)$ into $m$ $k$ -dimensional embeddings reside within LLM input space [21, 23, 60], where $e$ is the dimension of LLM embedding space. Additionally, like recent works [18, 54, 57] in enabling LLM to generate images, we add additional $R$ tokens, denoted as $[\mathrm{IMG}_1], \dots, [\mathrm{IMG}_R]$ to represent visual outputs and incorporate trainable matrix $\mathbf{W}_{gen} \in \mathbb{R}^{R \times e}$ into frozen LLM. The training objective is to minimize the negative log-likelihood of producing [IMG] tokens conditioned on previously interleaved image/text tokens $\mathcal{T}_{prev}$ :

$$
\mathcal {L} _ {\text {g e n}} = - \sum_ {r = 1} ^ {R} \log p \left(\left[ \operatorname {I M G} _ {r} \right] \mid \mathcal {T} _ {\text {p r e v}}, \left[ \operatorname {I M G} _ {<   r} \right]\right) \tag {4}
$$

where

$$
\mathcal {T} _ {p r e v} = \left\{\phi \left(I _ {<   i}\right) ^ {T} \mathbf {W} _ {v 2 t}, \psi \left(S _ {1: i}\right) \right\} \tag {5}
$$

where $i\in [2,n]$ is the number of text descriptions of the current step. To align [IMG] produced by LLM with LDM input space, we utilize a Transformer-based Mapper $LDM$ to project [IMG] tokens to the input space of first-stage finetuned LDM with $L$ learnable query embeddings $(q_{1},\dots,q_{L})\in \mathbb{R}^{L\times d}$ , where $L$ is the maximum input sequence length of the LDM, similar to BLIP-2 Q-Former [21]. The training objective is to minimize the distance between Mapper's output Gen Emb and the augmented conditional text representations of LDM, i.e., Fuse Emb introduced in Section 3.2, formulated as:

$$
\mathcal {L} _ {\text {a l i g n}} = \left\| \operatorname {M a p p e r} _ {L D M} \left(h _ {[ \operatorname {I M G} _ {1: R} ]}, q _ {1}, \dots q _ {L}\right) - c _ {i} \right\| _ {2} ^ {2} \tag {6}
$$

where $h_{[\mathrm{IMG}_{1:R}]}$ denotes the last hidden states of LLM's [IMG] tokens. Suppose we can get access to the original text without reference $S_i'$ . Then, $c_i$ is the augmented text embedding of caption $S_i'$ encoded by the first-stage model's text and visual encoder. For instance, if $S_i$ is "They are talking to each other," then $S_i'$ would be "Fred and Wilma are talking to each other." This non-referential text, augmented with character visual features, assists LLM in efficiently disambiguating references using casual language modeling. Inference. During the inference process, the model sequentially visualizes stories grounded on text descriptions. It begins by processing the text description of the initial frame $S_1$ . Focusing exclusively on frame generation, we constrain the LLM to generate only $R$ specific [IMG] tokens and then feed these token embeddings into the first-stage CharLDM, resulting in the generation of the first frame $I_1^{gen}$ . Subsequently, the LLM takes a contextual history that includes the text description of the first frame $S_1$ , the generated first frame $I_1^{gen}$ , and the text description of the second

frame $S_{2}$ as input. This process is repeated to visualize the entire story progressively.

# 4. Experiments

# 4.1. Experimental Setups

Datasets. Our experiments are conducted using two story visualization datasets: FlintstonesSV [12] and PororoSV [22]. FlintstonesSV [12] contains 20132-training, 2071-validation, and 2309-test stories with 7 main characters and 323 backgrounds, while PororoSV [22] consists of 10,191 training samples, 2,334 for validation, and 2,208 for testing with 9 main characters. We follow [38] to extend the datasets with referential text, by replacing the character names with references, i.e., he, she, or they, wherever applicable. Please refer to the supplementary for details.

Evaluation metrics. To measure the accuracy of the characters and background in the generated stories, we consider the following evaluation metrics the same as previous story visualization literature [26, 28, 38]: Following [26], we finetune Inception-v3 to measure the classification accuracy and F1-score of characters (Char-Acc, Char-F1) and background (BG-Acc, BG-F1) respectively. In addition, we consider the Frechet Inception Distance (FID) score, which compares the distribution between feature vectors from real and generated images for quality assessment.

When assessing text-image alignment, the CLIP [36] score falls short in reliability since it cannot capture fine-grained details. Therefore we choose the powerful captioning model BLIP2 [21] as the evaluation model and fine-tune it on the corresponding datasets. We then employ it as a captioner to predict 5 captions for generated images and 5 captions for ground truth images as a comparison to report the average BLEU4 [31] and CIDEr [51] score to assess text-image alignment.

Comparison Approaches. We compare our model with state-of-the-art approaches: VLCStoryGAN [26], StoryDALL-E [28], LDM [41] and Story-LDM [38]. Following previous research [22, 38], we use 4 consecutive frames for evaluation. For StoryDALL-E [28], which takes both story descriptions and the initial frame as input, we use the first frame of a 5-frame story and evaluate using the generated 4 frames. We finetune vanilla Stable Diffusion (LDM) on FlintStonesSV [12] and PororoSV [22] as a baseline. Since Story-LDM [38] does not provide pre-trained checkpoint or cleaned training code, we initiate training from pre-trained $\mathrm{LDM}^2$ .

Implementation Details. For the first stage training, we freeze CLIP [36] text encoder and fine-tune the remaining modules for 25k steps with a learning rate of 1e-5 and batch size of 32 on original non-referential text. To enhance

Table 1. Main experiments on FlintStonesSV [12]. The top portion is evaluated on the dataset w/o extended referential text. The bottom half displays the results on the extended dataset with co-reference. ${}^{ \dagger  }$ StoryDALL-E [28] takes the source frame as additional input.   

<table><tr><td>Models</td><td>Ref text</td><td>Char-Acc (↑)</td><td>Char-F1 (↑)</td><td>BG-Acc (↑)</td><td>BG-F1 (↑)</td><td>FID (↓)</td><td>BLEU4 (↑)</td><td>CIDEr (↑)</td></tr><tr><td>StoryDALL-E† [28]</td><td></td><td>69.49</td><td>83.35</td><td>48.46</td><td>55.24</td><td>44.24</td><td>0.4666</td><td>1.4473</td></tr><tr><td>LDM [41]</td><td></td><td>85.66</td><td>93.41</td><td>54.85</td><td>62.04</td><td>32.05</td><td>0.5230</td><td>1.8048</td></tr><tr><td>Story-LDM [38]</td><td>×</td><td>82.43</td><td>91.86</td><td>55.3</td><td>61.58</td><td>36.29</td><td>0.4656</td><td>1.4335</td></tr><tr><td>Char-LDM (Ours)</td><td></td><td>90.36</td><td>95.76</td><td>58.36</td><td>63.92</td><td>21.13</td><td>0.5260</td><td>1.8361</td></tr><tr><td>StoryDALL-E† [28]</td><td></td><td>61.83</td><td>78.36</td><td>48.10</td><td>54.92</td><td>44.66</td><td>0.4460</td><td>1.3373</td></tr><tr><td>LDM [41]</td><td></td><td>75.37</td><td>87.54</td><td>52.57</td><td>58.41</td><td>32.36</td><td>0.4911</td><td>1.5103</td></tr><tr><td>Story-LDM [38]</td><td>✓</td><td>77.23</td><td>88.26</td><td>54.97</td><td>60.99</td><td>36.34</td><td>0.4585</td><td>1.4004</td></tr><tr><td>StoryGPT-V (Ours)</td><td></td><td>87.96</td><td>94.17</td><td>56.01</td><td>61.07</td><td>21.71</td><td>0.5070</td><td>1.6607</td></tr></table>

inference time robustness and flexibility, we adopt a training strategy that includes $10\%$ unconditional training, i.e., classifier-free guidance [14], $10\%$ text-only training, and $80\%$ character-augmented fuse training (Section 3.2).

For the second stage training, we use OPT-6.7B $^3$ model as the LLM backbone. To expedite the second stage alignment training, we first pre-compute non-referential fused embeddings residing in the input space of the first-stage Char-LDM. We map visual features into $m = 4$ token embeddings as LLM input, set the max sequence length as 160 and the number of additional [IMG] tokens represents for LLM's visual output as $R = 8$ , batch size as 64 training for 20k steps. Please refer to the supplementary for more details.

# 4.2. Visual Story Generation

Quantitative Results. (i) Generation with original descriptions. The upper half of Table 1 shows the comparison results on original FlintStonesSV [12] without referential text descriptions. Our first-stage Char-LDM exhibits superior performance in generating accurate characters (Char-Acc, Char-F1) and background scenes (BG-Acc, BG-F1), achieving high fidelity (FID), and exhibiting better alignment with given text descriptions (BLEU4 [31], CIDEr [51]). (ii) Generation with co-referenced descriptions. Table 1 (bottom) and Table 2 show the results on extended FlintStonesSV [12] and PororoSV [22] with co-referential text descriptions [38] respectively. By harnessing the merit of reasoning and comprehension abilities of LLM, our model substantially boosts performance in reference resolution compared to baselines, while maintaining a strong text-image alignment grounded in the provided text descriptions.

Qualitative Results. Figure 3 demonstrates qualitative comparison on FlintStonesSV [12] and PororoSV [22] with co-reference descriptions. LDM [41] could generate high-quality images but struggles to produce correct characters in the presence of reference in the captions. Story-LDM [38],

Table 2. Performance comparison on PororoSV [22] with co-referenced descriptions. ${}^{ \dagger  }$ StoryDALL-E [28] takes the source frame as additional input.   

<table><tr><td>Models</td><td>Char-Acc (↑)</td><td>Char-F1 (↑)</td><td>FID (↓)</td><td>BLEU4 (↑)</td><td>CIDEr (↑)</td></tr><tr><td>StoryDALL-E† [28]</td><td>21.03</td><td>50.56</td><td>40.39</td><td>0.2295</td><td>0.3666</td></tr><tr><td>LDM [41]</td><td>27.81</td><td>57.02</td><td>28.98</td><td>0.2560</td><td>0.5122</td></tr><tr><td>Story-LDM [38]</td><td>29.14</td><td>57.56</td><td>26.64</td><td>0.2420</td><td>0.4581</td></tr><tr><td>StoryGPT-V (Ours)</td><td>36.06</td><td>62.70</td><td>19.56</td><td>0.2586</td><td>0.5279</td></tr></table>

despite incorporating an attention-memory module to handle context, fails to produce accurate characters in some frames. In comparison, our model excels at generating frames with pleasing visuals, accurate characters, and maintaining temporal consistency in the background scenes.

Human Evaluation. In addition, we use Mechanical Turk to assess the quality of 100 stories produced by our methods or Story-LDM [38] on FlintStonesSV [12]. Given a pair of stories generated by Story-LDM [38] and our model, MTurkers are asked to decide which generated four-frame story is better w.r.t visual quality, text-image alignment, character accuracy, and temporal consistency. Each pair is evaluated by 3 unique workers. In Figure 4, our model demonstrates significantly better story visualization quality with accurate and temporally coherent synthesis.

# 4.3. Ablation Studies

First stage ablation. We conducted an ablation study for the first stage and presented results in Table 3. $w/o \mathcal{L}_{reg}$ indicates that we disabled the $\mathcal{L}_{reg}$ loss (Equation 3.2), i.e., the model underwent training without the influence of segmentation masks to direct the cross-attention maps. $w/o$ augmented text signifies that the model's conditional input during its training phase was the standard CLIP [36] text embedding, rather than the fused embedding incorporating the character's visual attributes as discussed in Section 3.2. freeze vis denotes the visual encoder remained frozen during training. Unless specified, the last two layers of the visual encoder are made adjustable. The final two rows employ our default training strategy and the only distinction lies in the inference phase. Default $(w/o img)$

Fred is standing in the living room while holding the phone and talking.   
He is in a room. He picks up the phone and then speaks into the phone.   
- He stands next to a small table in the room. He holds the receiver for a phone while talking to someone. He then hangs up the phone when he finishes the call.   
- Fred and Barney are standing in a room. There is a telephone next to Fred. Barney is talking with something in his hand.

- Poby is seated beside a canvas. He holds a red pencil in his hand. There are many pictures on the wall.   
- He is seated beside a canvas. He holds a red pencil in his hand. He lowers down his arm and makes a big smile. There are many pictures on the wall.   
- Harry is in a house. Harry is seated on a green bed.   
- He comes out of the house. He looks around the room. In the middle of the room, there is a wooden table. There is an apple on the table.

![](images/b207fde4b294b5b9dd6a93c891d9fd442b67ee3614c9e046f806c1c9668ebf99.jpg)

![](images/c97c58f225fcad221d88c8a3841e78e407aff6940963018765604d74b47694b3.jpg)  
Figure 3. Qualitative comparison on FlintStonesSV [12] (left) and PororoSV [22] (right) with co-reference descriptions.

![](images/4a95b7503d2b1a527c01deb7b261c98ee8e6d81e790505ebdd1e01246e4eb2fe.jpg)  
Figure 4. Human evaluation results on FlintStonesSV [12] w.r.t visual quality, text-image alignment, character accuracy and temporal consistency.

takes vanilla CLIP [36] text embedding as input condition, whereas Default (w/img) employs the fused embedding. As indicated by Table 3, integrating character visual features during training significantly enhances the generation performance and the additional cross-attention control propels the model to achieve its peak on accurate character generation. Note that the FID score of Default (w/img) is slightly higher than Default (w/o img). This is because, during in

ference, the reference images for corresponding characters in Default $(w / img)$ are obtained online, introducing a slight deviation from the original distribution.

Table 3. Ablation study for the first stage finetuning LDM with cross-attention control.   

<table><tr><td>Models</td><td>Char-Acc (↑)</td><td>Char-F1 (↑)</td><td>BG-Acc (↑)</td><td>BG-F1 (↑)</td><td>FID (↓)</td></tr><tr><td>w/o Lreg</td><td>88.86</td><td>95.21</td><td>55.50</td><td>60.77</td><td>23.51</td></tr><tr><td>w/o augmented text</td><td>87.45</td><td>94.70</td><td>57.67</td><td>63.04</td><td>21.27</td></tr><tr><td>freeze vis</td><td>88.67</td><td>95.14</td><td>56.58</td><td>62.46</td><td>22.01</td></tr><tr><td>Default (w/o img)</td><td>89.73</td><td>95.56</td><td>56.18</td><td>62.85</td><td>20.96</td></tr><tr><td>Default (w/ img)</td><td>90.36</td><td>95.76</td><td>58.36</td><td>63.92</td><td>21.13</td></tr></table>

Second stage ablation. As shown in Table 4, we conducted an ablation study on (i) whether to align with the text embedding $(\mathsf{Emb}_{\mathsf{text}})$ or the fused embedding $(\mathsf{Emb}_{\mathsf{fuse}})$ of our first stage model; (ii) whether the model's input consists of a sequence of captions (Caption-) or utilizes interleaved training with both images and captions (Interleave-) (Equation 3.3). Experimental results shown in Table 4 indicate that image-text interleave training can significantly enhance performance. It is intuitive that taking both images and corresponding captions as input provides a more profound comprehension of the characters and their interactions within the image than when provided with sole captions. This, in turn, amplifies its generative capabilities.

Table 4. Second stage training strategy ablation. Input only caption or interleaved text and image. The output of LLM is aligned with our Char-LDM text embedding (Emb_text) or character-augmented fused embedding (Emb_use).   

<table><tr><td>Models</td><td>Char-Acc (↑)</td><td>Char-F1 (↑)</td><td>BG-Acc (↑)</td><td>BG-F1 (↑)</td><td>FID (↓)</td></tr><tr><td>Caption-Emb_text</td><td>69.70</td><td>83.37</td><td>52.67</td><td>58.78</td><td>21.32</td></tr><tr><td>Caption-Emb_fuse</td><td>71.77</td><td>84.81</td><td>52.57</td><td>58.04</td><td>24.79</td></tr><tr><td>Interleave-Emb_text</td><td>86.10</td><td>93.46</td><td>54.92</td><td>60.15</td><td>21.30</td></tr><tr><td>Interleave-Emb_fuse (default)</td><td>87.96</td><td>94.17</td><td>56.01</td><td>61.07</td><td>21.71</td></tr></table>

![](images/10e838fc479744ead046fc1319839d6e571be43f41a0e4c3c2943526e73c6871.jpg)  
Figure 5. Visualization of cross attention maps of corresponding character tokens.

# 4.4. Analysis

We further investigate the impact of first-stage finetuning with cross-attention control by visualizing averaged cross-attention maps in U-Net latent pixel space and interpolating them to match the size of the generated images. As illustrated in Figure 5, vanilla LDM (top) finetune on Flint-StonesSV [12] w/o $\mathcal{L}_{reg}$ (Section 3.2) fails to accurately focus on the corresponding characters for character tokens. Our model (bottom), which incorporates cross-attention guidance, is able to precisely direct attention to generated characters given corresponding character tokens.

# 4.5. Properties

Our model could generate longer stories featuring accurate characters, at a faster speed and with lower computational consumption. Our architecture allows our model to retain an extensive context requiring minimal computational resources by efficiently mapping visual features into tokens instead of operating in pixel space. Figure 6 shows the comparison between our model and Story-LDM [38] w.r.t GPU memory consumption and inference speed for longer-frames story generation. Our model is capable of producing sequences exceeding 50 frames with low memory usage, whereas Story-LDM [38] encounters GPU memory limitations (80G A100) when generating 42 frames. This is because Story-LDM [38] requires the retention of the entire context, e.g., $n$ frames in latent pixel space ( $n \times h \times w \times d$ ), whereas our model processes visual features as four token embedding ( $n \times 4 \times d$ ) with the same dimensions as the text tokens in LLM. Table 5 compares the accuracy of gener

![](images/de6a44a104925615a49effa39241b1a6467e784561777724a3745cf0bfe2ecf6.jpg)

![](images/381c3e619f011cc95f3e495902298089ea5aa02904bda2d1b0ee9cb69ef12be6.jpg)  
Figure 6. Compare inference speed and GPU memory consumption between our method and Story-LDM [38]. Story-LDM encounters the 80GB GPU limit when generating sequences exceeding 40 frames.

ated characters and FID score for long story visualizations between our model and Story-LDM [38]. The performance of Story-LDM [38] significantly decreases when generating longer stories and reaches the memory limit before 50 frames. In contrast, by utilizing the capacity of LLM to retain extensive context, our model upholds accurate character consistency in visualizing lengthy narratives with co-referential text descriptions.

Table 5. Longer-frames story visualization comparison on Flint-StonesSV [12] with referential text. Story-LDM reaches maximum GPU capacity when generating 50 frames.   

<table><tr><td>Models</td><td>Metric</td><td>4</td><td>10</td><td>20</td><td>40</td><td>50</td></tr><tr><td rowspan="2">Story-LDM [38]</td><td>Char-Acc (↑)</td><td>77.23</td><td>74.84</td><td>69.01</td><td>63.40</td><td>N/A</td></tr><tr><td>FID (↓)</td><td>36.34</td><td>48.92</td><td>53.32</td><td>60.33</td><td>N/A</td></tr><tr><td rowspan="2">StoryGPT-V (Ours)</td><td>Char-Acc (↑)</td><td>85.44</td><td>84.63</td><td>82.86</td><td>81.04</td><td>80.92</td></tr><tr><td>FID (↓)</td><td>27.08</td><td>38.91</td><td>42.60</td><td>48.37</td><td>61.23</td></tr></table>

Our design could be easily adapted to any LLMs. In our work, we experimented with OPT-6.7b $^4$ and Llama2-7b-chat $^5$ models. Our findings, as illustrated in Table 9, indicate an improvement when changing from OPT [58] to a more powerful model, Llama2 [48].

Table 6. Performance on FlintstonesSV [12] dataset with referential text using different LLMs.   

<table><tr><td>Models</td><td># Params</td><td>Char-Acc (↑)</td><td>Char-F1 (↑)</td><td>BG-Acc (↑)</td><td>BG-F1 (↑)</td><td>FID (↓)</td><td>BLEU4 (↑)</td><td>CIDEr (↑)</td></tr><tr><td>OPT [58]</td><td>6.7b</td><td>87.96</td><td>94.17</td><td>56.01</td><td>61.07</td><td>21.71</td><td>0.5070</td><td>1.6607</td></tr><tr><td>Llama2 [48]</td><td>7b</td><td>89.08</td><td>95.07</td><td>57.29</td><td>62.62</td><td>21.56</td><td>0.5169</td><td>1.7516</td></tr></table>

Our model, StoryGPT-V, is capable for multi-model generation. Owing to StoryGPT-V design leveraging the advanced capabilities of Large Language Models (LLMs), it exhibits a unique proficiency in that it can extend visual stories. StoryGPT-V is not merely limited to visualizing stories based on provided textual descriptions. Unlike existing models, it also possesses the innovative capacity to

extend these narratives through continuous text generation. Concurrently, it progressively synthesizes images that align with the newly generated text segments.

Our model represents a notable advancement in story visualization, being the first of its kind to consistently produce both high-quality images and coherent narrative descriptions. This innovation opens avenues for AI-assisted technologies to accelerate visual storytelling creation experiences by exploring various visualized plot extensions as the story builds.

# 5. Conclusion

In this paper, we aim at high-quality and consistent character synthesis for story visualization grounded on co-referential text descriptions. To accomplish this, we utilize the strengths of the LDM for generating high-quality images, combined with the reasoning capability of LLM to comprehend extended contexts, resolve ambiguities, and ensure semantic consistency in the generation process. We first finetune LDM by guiding the cross-attention map of LDM with character segmentation masks, which improves the accuracy and faithfulness of character generation. Next, we facilitate a mapping from the output of LLM to align with the input space of the first stage LDM, thus allowing Multi-modal LLM to both process and produce images. This process leverages the LLM's logical reasoning to clarify ambiguous references and its capacity to retain contextual information. Our model reports superior quantitative results and consistently generates characters with remarkable quality.

# References

[1] Jean-Baptiste Alayrac, Jeff Donahue, Pauline Luc, Antoine Miech, Iain Barr, Yana Hasson, Karel Lenc, Arthur Mensch, Katherine Millican, Malcolm Reynolds, et al. Flamingo: a visual language model for few-shot learning. Advances in Neural Information Processing Systems, 35:23716-23736, 2022. 2   
[2] Chinatsu Aone and Scott William. Evaluating automated and manual acquisition of anaphora resolution strategies. In 33rd Annual Meeting of the Association for Computational Linguistics, pages 122-129, 1995. 1   
[3] Tom Brown, Benjamin Mann, Nick Ryder, Melanie Subbiah, Jared D Kaplan, Prafulla Dhariwal, Arvind Neelakantan, Pranav Shyam, Girish Sastry, Amanda Askell, et al. Language models are few-shot learners. Advances in neural information processing systems, 33:1877-1901, 2020. 2   
[4] Hong Chen, Rujun Han, Te-Lin Wu, Hideki Nakayama, and Nanyun Peng. Character-centric story visualization via visual planning and token alignment. arXiv preprint arXiv:2210.08465, 2022. 1   
[5] Jun Chen, Han Guo, Kai Yi, Boyang Li, and Mohamed Elhoseiny. Visualgpt: Data-efficient adaptation of pretrained language models for image captioning. In Proceedings of

the IEEE/CVF Conference on Computer Vision and Pattern Recognition, pages 18030-18040, 2022. 2   
[6] Jun Chen, Deyao Zhu, Xiaogian Shen, Xiang Li, Zechun Liu, Pengchuan Zhang, Raghuraman Krishnamoorthi, Vikas Chandra, Yunyang Xiong, and Mohamed Elhoseiny. Minigpt-v2: large language model as a unified interface for vision-language multi-task learning, 2023. 2   
[7] Guillaume Couairon, Marlene Careil, Matthieu Cord, Stéphane Lathuilière, and Jakob Verbeek. Zero-shot spatial layout conditioning for text-to-image diffusion models. In Proceedings of the IEEE/CVF International Conference on Computer Vision, pages 2174-2183, 2023. 3   
[8] Katherine Crowson, Stella Biderman, Daniel Kornis, Dashiell Stander, Eric Hallahan, Louis Castricato, and Edward Raff. Vqgan-clip: Open domain image generation and editing with natural language guidance. In European Conference on Computer Vision, pages 88–105. Springer, 2022. 2   
[9] Ming Ding, Zhuoyi Yang, Wenyi Hong, Wendi Zheng, Chang Zhou, Da Yin, Junyang Lin, Xu Zou, Zhou Shao, Hongxia Yang, et al. Cogview: Mastering text-to-image generation via transformers. Advances in Neural Information Processing Systems, 34:19822-19835, 2021.   
[10] Oran Gafni, Adam Polyak, Oron Ashual, Shelly Sheynin, Devi Parikh, and Yaniv Taigman. Make-a-scene: Scene-based text-to-image generation with human priors. In European Conference on Computer Vision, pages 89-106. Springer, 2022. 2   
[11] Yuying Ge, Yixiao Ge, Ziyun Zeng, Xintao Wang, and Ying Shan. Planting a seed of vision in large language model. arXiv preprint arXiv:2307.08041, 2023. 2   
[12] Tanmay Gupta, Dustin Schwenk, Ali Farhadi, Derek Hoiem, and Aniruddha Kembhavi. Imagine this! scripts to compositions to videos. In Proceedings of the European conference on computer vision (ECCV), pages 598-613, 2018. 5, 6, 7, 8, 12, 13, 14, 15, 16, 17, 18   
[13] Amir Hertz, Ron Mokady, Jay Tenenbaum, Kfir Aberman, Yael Pritch, and Daniel Cohen-Or. Prompt-to-prompt image editing with cross attention control. arXiv preprint arXiv:2208.01626, 2022. 3   
[14] Jonathan Ho and Tim Salimans. Classifier-free diffusion guidance. arXiv preprint arXiv:2207.12598, 2022. 6, 15   
[15] Jonathan Ho, Ajay Jain, and Pieter Abbeel. Denoising diffusion probabilistic models. Advances in neural information processing systems, 33:6840-6851, 2020. 3   
[16] Shaohan Huang, Li Dong, Wenhui Wang, Yaru Hao, Saksham Singhal, Shuming Ma, Tengchao Lv, Lei Cui, Owais Khan Mohammed, Qiang Liu, et al. Language is not all you need: Aligning perception with language models. arXiv preprint arXiv:2302.14045, 2023. 2   
[17] Alexander Kirillov, Eric Mintun, Nikhila Ravi, Hanzi Mao, Chloe Rolland, Laura Gustafson, Tete Xiao, Spencer Whitehead, Alexander C Berg, Wan-Yen Lo, et al. Segment anything. arXiv preprint arXiv:2304.02643, 2023. 3, 15   
[18] Jing Yu Koh, Daniel Fried, and Ruslan Salakhutdinov. Generating images with multimodal language models. arXiv preprint arXiv:2305.17216, 2023. 2, 5

[19] Jing Yu Koh, Ruslan Salakhutdinov, and Daniel Fried. Grounding language models to images for multimodal generation. arXiv preprint arXiv:2301.13823, 2023. 2   
[20] Bo Li, Yuanhan Zhang, Liangyu Chen, Jinghao Wang, Jingkang Yang, and Ziwei Liu. Otter: A multi-modal model with in-context instruction tuning. arXiv preprint arXiv:2305.03726, 2023. 2   
[21] Junnan Li, Dongxu Li, Silvio Savarese, and Steven Hoi. Blip-2: Bootstrapping language-image pre-training with frozen image encoders and large language models. arXiv preprint arXiv:2301.12597, 2023. 2, 5, 13   
[22] Yitong Li, Zhe Gan, Yelong Shen, Jingjing Liu, Yu Cheng, Yuexin Wu, Lawrence Carin, David Carlson, and Jianfeng Gao. Storygan: A sequential conditional gan for story visualization. In Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition, pages 6329-6338, 2019. 1, 2, 5, 6, 7, 13, 15, 16, 18, 19   
[23] Haotian Liu, Chunyuan Li, Qingyang Wu, and Yong Jae Lee. Visual instruction tuning. arXiv preprint arXiv:2304.08485, 2023. 5   
[24] Shaoteng Liu, Yuechen Zhang, Wenbo Li, Zhe Lin, and Jiaya Jia. Video-p2p: Video editing with cross-attention control. arXiv preprint arXiv:2303.04761, 2023. 3   
[25] Yiyang Ma, Huan Yang, Wenjing Wang, Jianlong Fu, and Jiaying Liu. Unified multi-modal latent diffusion for joint subject and text conditional image generation. arXiv preprint arXiv:2303.09319, 2023. 3   
[26] Adyasha Maharana and Mohit Bansal. Integrating visuospatial, linguistic and commonsense structure into story visualization. arXiv preprint arXiv:2110.10834, 2021. 1, 2, 5   
[27] Adyasha Maharana, Darryl Hannan, and Mohit Bansal. Improving generation and evaluation of visual stories via semantic consistency. arXiv preprint arXiv:2105.10026, 2021. 1, 2   
[28] Adyasha Maharana, Darryl Hannan, and Mohit Bansal. Storydall-e: Adapting pretrained text-to-image transformers for story continuation. In European Conference on Computer Vision, pages 70-87. Springer, 2022. 1, 2, 5, 6, 14   
[29] Joseph F McCarthy and Wendy G Lehnert. Using decision trees for coreference resolution. arXiv preprint cmplg/9505043, 1995. 1   
[30] OpenAI. Dall-e 3. https://openai.com/dall-e-3/, 2023. 16   
[31] Kishore Papineni, Salim Roukos, Todd Ward, and Wei-Jing Zhu. Bleu: a method for automatic evaluation of machine translation. In Proceedings of the 40th annual meeting of the Association for Computational Linguistics, pages 311-318, 2002. 5, 6, 13, 14   
[32] Gaurav Parmar, Krishna Kumar Singh, Richard Zhang, Yijun Li, Jingwan Lu, and Jun-Yan Zhu. Zero-shot image-to-image translation. In ACM SIGGRAPH 2023 Conference Proceedings, pages 1-11, 2023. 3   
[33] Alec Radford, Karthik Narasimhan, Tim Salimans, Ilya Sutskever, et al. Improving language understanding by generative pre-training. 2018. 4   
[34] Alec Radford, Jeffrey Wu, Rewon Child, David Luan, Dario Amodei, Ilya Sutskever, et al. Language models are unsu

pervised multitask learners. OpenAI blog, 1(8):9, 2019. 2, 4   
[35] Alec Radford, Jong Wook Kim, Chris Hallacy, A. Ramesh, Gabriel Goh, Sandhini Agarwal, Girish Sastry, Amanda Askell, Pamela Mishkin, Jack Clark, Gretchen Krueger, and Ilya Sutskever. Learning transferable visual models from natural language supervision. In ICML, 2021. 15   
[36] Alec Radford, Jong Wook Kim, Chris Hallacy, Aditya Ramesh, Gabriel Goh, Sandhini Agarwal, Girish Sastry, Amanda Askell, Pamela Mishkin, Jack Clark, et al. Learning transferable visual models from natural language supervision. In International conference on machine learning, pages 8748-8763. PMLR, 2021. 1, 3, 5, 6, 7, 12, 13, 14   
[37] Colin Raffel, Noam Shazeer, Adam Roberts, Katherine Lee, Sharan Narang, Michael Matena, Yanqi Zhou, Wei Li, and Peter J Liu. Exploring the limits of transfer learning with a unified text-to-text transformer. The Journal of Machine Learning Research, 21(1):5485-5551, 2020. 2   
[38] Tanzila Rahman, Hsin-Ying Lee, Jian Ren, Sergey Tulyakov, Shweta Mahajan, and Leonid Sigal. Make-a-story: Visual memory conditioned consistent story generation. In Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition, pages 2493-2502, 2023. 1, 3, 5, 6, 8, 14, 15   
[39] Aditya Ramesh, Mikhail Pavlov, Gabriel Goh, Scott Gray, Chelsea Voss, Alec Radford, Mark Chen, and Ilya Sutskever. Zero-shot text-to-image generation. In International Conference on Machine Learning, pages 8821-8831. PMLR, 2021. 2   
[40] Aditya Ramesh, Prafulla Dhariwal, Alex Nichol, Casey Chu, and Mark Chen. Hierarchical text-conditional image generation with clip latents. arXiv preprint arXiv:2204.06125, 1 (2):3, 2022.   
[41] Robin Rombach, Andreas Blattmann, Dominik Lorenz, Patrick Esser, and Björn Ommer. High-resolution image synthesis with latent diffusion models. In Proceedings of the IEEE/CVF conference on computer vision and pattern recognition, pages 10684-10695, 2022. 2, 3, 5, 6, 13, 14, 15   
[42] Olaf Ronneberger, Philipp Fischer, and Thomas Brox. U-net: Convolutional networks for biomedical image segmentation. In Medical Image Computing and Computer-Assisted Intervention-MICCAI 2015: 18th International Conference, Munich, Germany, October 5-9, 2015, Proceedings, Part III 18, pages 234-241. Springer, 2015. 3   
[43] Chitwan Sahara, William Chan, Saurabh Saxena, Lala Li, Jay Whang, Emily L Denton, Kamyar Ghasemipour, Raphael Gontijo Lopes, Burcu Karagol Ayan, Tim Salimans, et al. Photorealistic text-to-image diffusion models with deep language understanding. Advances in Neural Information Processing Systems, 35:36479-36494, 2022. 2   
[44] Paul Hongsuck Seo, Andreas Lehrmann, Bohyung Han, and Leonid Sigal. Visual reference resolution using attention memory for visual dialog. Advances in neural information processing systems, 30, 2017. 1   
[45] Jing Shi, Wei Xiong, Zhe Lin, and Hyun Joon Jung. Instantbooth: Personalized text-to-image generation without test-time finetuning. arXiv preprint arXiv:2304.03411, 2023. 3

[46] Jiaming Song, Chenlin Meng, and Stefano Ermon. Denoising diffusion implicit models. arXiv preprint arXiv:2010.02502, 2020.3   
[47] Yun-Zhu Song, Zhi Rui Tam, Hung-Jen Chen, Huiao-Han Lu, and Hong-Han Shuai. Character-preserving coherent story visualization. In European Conference on Computer Vision, pages 18-33. Springer, 2020. 1   
[48] Hugo Touvron, Louis Martin, Kevin Stone, Peter Albert, Amjad Almahairi, Yasmine Babaei, Nikolay Bashlykov, Soumya Batra, Prajjwal Bhargava, Shruti Bhosale, et al. Llama 2: Open foundation and fine-tuned chat models. arXiv preprint arXiv:2307.09288, 2023. 8, 13   
[49] Maria Tsimpoukelli, Jacob L Menick, Serkan Cabi, SM Eslami, Oriol Vinyals, and Felix Hill. Multimodal few-shot learning with frozen language models. Advances in Neural Information Processing Systems, 34:200-212, 2021. 2   
[50] Ashish Vaswani, Noam Shazeer, Niki Parmar, Jakob Uszkoreit, Llion Jones, Aidan N Gomez, Lukasz Kaiser, and Illia Polosukhin. Attention is all you need. Advances in neural information processing systems, 30, 2017. 4   
[51] Ramakrishna Vedantam, C Lawrence Zitnick, and Devi Parikh. Cider: Consensus-based image description evaluation. In Proceedings of the IEEE conference on computer vision and pattern recognition, pages 4566-4575, 2015. 5, 6, 13, 14   
[52] Wenhai Wang, Zhe Chen, Xiaokang Chen, Jiannan Wu, Xizhou Zhu, Gang Zeng, Ping Luo, Tong Lu, Jie Zhou, Yu Qiao, et al. Visionllm: Large language model is also an open-ended decoder for vision-centric tasks. arXiv preprint arXiv:2305.11175, 2023. 2   
[53] Yuxiang Wei, Yabo Zhang, Zhilong Ji, Jinfeng Bai, Lei Zhang, and Wangmeng Zuo. Elite: Encoding visual concepts into textual embeddings for customized text-to-image generation. arXiv preprint arXiv:2302.13848, 2023. 3   
[54] Shengqiong Wu, Hao Fei, Leigang Qu, Wei Ji, and Tat-Seng Chua. Next-gpt: Any-to-any multimodal llm. arXiv preprint arXiv:2309.05519, 2023. 2, 5   
[55] Guangxuan Xiao, Tianwei Yin, William T Freeman, Frédo Durand, and Song Han. Fastcomposer: Tuning-free multisubject image generation with localized attention. arXiv preprint arXiv:2305.10431, 2023. 3   
[56] Gangyan Zeng, Zhaohui Li, and Yuan Zhang. Pororogan: An improved story visualization model on pororo-sv dataset. In Proceedings of the 2019 3rd International Conference on Computer Science and Artificial Intelligence, pages 155-159, 2019. 1   
[57] Lai Zeqiang, Zhu Xizhou, Dai Jifeng, Qiao Yu, and Wang Wenhai. Mini-dalle3: Interactive text to image by prompting large language models. arXiv preprint arXiv:2310.07653, 2023. 2, 5   
[58] Susan Zhang, Stephen Roller, Naman Goyal, Mikel Artetxe, Moya Chen, Shuohui Chen, Christopher Dewan, Mona Diab, Xian Li, Xi Victoria Lin, et al. Opt: Open pre-trained transformer language models. arXiv preprint arXiv:2205.01068, 2022. 2, 8, 13   
[59] Yanzhe Zhang, Ruiyi Zhang, Jiumi Wang, Yuhan Zhou, Nedim Lipka, Diyi Yang, and Tong Sun. Llavar: Enhanced

visual instruction tuning for text-rich image understanding. arXiv preprint arXiv:2306.17107, 2023. 2   
[60] Deyao Zhu, Jun Chen, Xiaogian Shen, Xiang Li, and Mohamed Elhoseiny. Minigpt-4: Enhancing vision-language understanding with advanced large language models. arXiv preprint arXiv:2304.10592, 2023. 2, 5

# Appendix

![](images/6549f7c1fd64dd0d4e34c03d530064e235874d82fb75f86c4475bbd60ef9d040.jpg)  
Figure 7. Our model StoryGPT-V extending stories in both language and vision: Gray part represents the text descriptions from datasets. Blue part corresponds to the frames and the continued written stories based on the previous captions generated by our model StoryGPT-V. This is the first model capable of story visualization and multi-modal story generation (continuation) by leveraging an LLM.

# A. Multi-modal Story Generation

Owing to StoryGPT-V design leveraging the advanced capabilities of Large Language Models (LLMs), it exhibits a unique proficiency in that it can extend visual stories. StoryGPT-V is not merely limited to visualizing stories based on provided textual descriptions. Unlike existing models, it also possesses the innovative capacity to extend these narratives through continuous text generation. Concurrently, it progressively synthesizes images that align with the newly generated text segments.

Figure 7 presents an example of a multi-modal story generation. Initially, the first four frames are created according to the text descriptions from the FlintstonesSV [12] dataset (gray part). Subsequently, the model proceeds to write the description for the next frame (blue part), taking into account the captions provided earlier, and then creates a frame based on this new description (blue part). This method is employed iteratively to generate successive text descriptions and their corresponding frames.

Our model represents a notable advancement in story visualization, being the first of its kind to consistently produce both high-quality images and coherent narrative descriptions. This innovation opens avenues for AI-assisted technologies to accelerate visual storytelling creation experiences by exploring various visualized plot extensions as the story builds.

# B. Ablation Studies

# B.1. Effect of first-stage design.

In Table 7 lower half, we conducted an ablation study on how the stage-1 design contributes to the final performance. In the first line, the stage-2 LLM is aligned with vanilla LDM fine-tuned on FlintstonesSV [12]. The second line aligns the LLM output with our Char-LDM's text embedding $(\mathsf{Emb}_{text})$ , while the last line aligns with character-augmented fused embedding $(\mathsf{Emb}_{fuse})$ of our Char-LDM. The first two lines align to the same text embedding encoded by the CLIP [36] text encoder, however, our Char-LDM enhanced with cross-attention control $(\mathcal{L}_{reg})$ produces more precise characters. Different from $\mathsf{Emb}_{text}$ , the last line is aligned with $\mathsf{Emb}_{fuse}$ , which is augmented with characters' visual features. This visual guidance helps LLM to interpret references more effectively by linking "he, she, they" to the previous language and image context.

# B.2. Number of [IMG] Tokens

We further examined the impact of the number of added [IMG] tokens. As indicated in Table 8, aligning with the fused embedding and setting $R = 8$ yields the best performance.

<table><tr><td>Models</td><td>Aligning space</td><td>Char-Acc (↑)</td><td>Char-F1 (↑)</td><td>BG-Acc (↑)</td><td>BG-F1 (↑)</td><td>FID (↓)</td></tr><tr><td>Vanilla LDM [41]</td><td>×</td><td>75.37</td><td>87.54</td><td>52.57</td><td>58.41</td><td>32.36</td></tr><tr><td rowspan="3">Our Stage-2</td><td>Vanilla LDM Embtext</td><td>84.06</td><td>92.54</td><td>53.18</td><td>58.29</td><td>22.94</td></tr><tr><td>Char-LDM Embtext</td><td>86.10</td><td>93.46</td><td>54.92</td><td>60.15</td><td>21.30</td></tr><tr><td>Char-LDM Embfuse (default)</td><td>87.96</td><td>94.17</td><td>56.01</td><td>61.07</td><td>21.71</td></tr></table>

Table 7. The output of our stage-2 model is aligned with conditional input of vanilla LDM [41] (finetuned on FlintstonesSV [12]), our Char-LDM text embedding $(\mathsf{Emb}_{text})$ or character-augmented fused embedding $(\mathsf{Emb}_{fuse})$ .   

<table><tr><td>Models</td><td>R</td><td>Char-Acc (↑)</td><td>Char-F1 (↑)</td><td>BG-Acc (↑)</td><td>BG-F1 (↑)</td><td>FID (↓)</td></tr><tr><td>Emb_text</td><td>4</td><td>82.14</td><td>90.18</td><td>54.28</td><td>59.58</td><td>21.33</td></tr><tr><td>Emb_text</td><td>8</td><td>86.10</td><td>93.46</td><td>54.92</td><td>60.15</td><td>21.30</td></tr><tr><td>Emb_text</td><td>16</td><td>83.77</td><td>91.07</td><td>54.08</td><td>60.21</td><td>21.58</td></tr><tr><td>Emb_fuse</td><td>4</td><td>86.23</td><td>93.43</td><td>54.57</td><td>59.61</td><td>21.97</td></tr><tr><td>Emb_fuse</td><td>8</td><td>87.96</td><td>94.17</td><td>56.01</td><td>61.07</td><td>21.71</td></tr><tr><td>Emb_fuse</td><td>16</td><td>85.35</td><td>91.96</td><td>52.93</td><td>58.86</td><td>23.73</td></tr></table>

Table 8. StoryGPT-V Ablations: Impact of $R$ ,the number of added [IMG] tokens. Emb ${}_{text}$ : the output of LLM is aligned with text embedding extracted from the text encoder; Emb ${}_{\text{use}}$ : aligned with fused embedding Emb ${}_{\text{use}}$ of first stage model.   
Table 9. Performance on FlintstonesSV [12] dataset with referential text using different LLMs.   

<table><tr><td>Models</td><td># Params</td><td>Char-Acc (↑)</td><td>Char-F1 (↑)</td><td>BG-Acc (↑)</td><td>BG-F1 (↑)</td><td>FID (↓)</td><td>BLEU4 (↑)</td><td>CIDEr (↑)</td></tr><tr><td>OPT [58]</td><td>6.7b</td><td>87.96</td><td>94.17</td><td>56.01</td><td>61.07</td><td>21.71</td><td>0.5070</td><td>1.6607</td></tr><tr><td>Llama2 [48]</td><td>7b</td><td>89.08</td><td>95.07</td><td>57.29</td><td>62.62</td><td>21.56</td><td>0.5169</td><td>1.7516</td></tr></table>

# B.3. Different LLMs (OPT vs Llama2)

Our primary contribution lies in leveraging Large Language Models (LLMs) for reference resolution for consistent story visualization. In our work, we experimented with OPT-6.7b $^{6}$ and Llama2-7b-chat $^{7}$ models. It's important to note that the utilization of Llama2 was specifically to demonstrate its additional capability for multi-modal generation. The ablation study of different LLMs was not the main focus of our research.

Our findings, as illustrated in Table 9, indicate only a slight improvement when changing from OPT [58] to Llama2 [48]. This marginal difference is attributed to the evaluation metric's emphasis on image-generation capabilities, which assesses whether the model's visual output aligns well with first-stage Char-LDM's conditional input space.

# C. Evaluation

# C.1. Text-image alignment.

CLIP [36] is trained on large-scale image-caption pairs to align visual and semantic space. However, a domain gap exists between pre-train data and the story visualization benchmark. Therefore, we finetune CLIP [36] on the story visualization datasets. However, we found it still hard to capture fine-grained semantics, either text-image (T-I) similarity or image-image similarity (I-I), i.e., the similarity between visual features of generated images and corresponding ground truth images.

Upon this observation, we choose the powerful captioning model BLIP2 [21] as the evaluation model. We finetune BLIP2 on FlintstonesSV [12] and PororoSV [22], respectively, and employ it as an image captioner for generated visual stories. We avoided direct comparisons to bridge the gap between BLIP2's predictions and the actual ground truth captions. Instead, we used the fine-tuned BLIP2 to generate five captions for each ground truth image and one caption for each generated image and report average BLEU4 [31] or CIDEr [51] score based on these comparisons.

Table 10. Text-image alignment score for FlintstonesSV [12] with referential text descriptions in terms of CLIP [36] similarity, BLEU4 [31] and CIDEr [51].   

<table><tr><td>Models</td><td>CLIP (T-I) (↑)</td><td>CLIP (I-I) (↑)</td><td>BLEU4 (↑)</td><td>CIDEr (↑)</td></tr><tr><td>StoryDALL-E [28]</td><td>0.4417</td><td>0.8112</td><td>0.4460</td><td>1.3373</td></tr><tr><td>LDM [41]</td><td>0.5007</td><td>0.8786</td><td>0.4911</td><td>1.5103</td></tr><tr><td>Story-LDM [38]</td><td>0.4979</td><td>0.8795</td><td>0.4585</td><td>1.4004</td></tr><tr><td>StoryGPT-V (Ours)</td><td>0.5106</td><td>0.889</td><td>0.5070</td><td>1.6607</td></tr></table>

# C.2. Human evaluation.

We use Mechanical Turk to assess the quality of 100 stories produced by our methods or Story-LDM [38] on Flint-StonesSV [12]. Given a pair of stories generated by Story-LDM [38] and our model, people are asked to decide which generated four-frame story is better w.r.t visual quality, text-image alignment, character accuracy and temporal consistency. Each pair is evaluated by 3 unique workers. The human study interface is illustrated in Figure 8.

# Instructions

Take a look at the images and choose your favorite.

Feel free to compare them with the reference images if you're uncertain about your choice.

Please carefully observe the generated images and answer questions for at least 1 minute, otherwise you will get rejected.

Please observe the AI generated four-frame stories based on the given text descriptions and answer the questions below:

Text descriptions:

Frame1: Fred is eating in the dining room. He spins a bone between his fingers and eats from it, then licks his lips.

Frame2: He is in a room. His fingers are in a Chinese finger trap. He speaks to someone.

Frame3: He is holding a chinese finger trap in the room.

Frame4: Pebbles sits in a purple highchair in the dining room listening intently.

![](images/2bd4fb46e8f1163e94a9bcc3b5cc388f7bee36e9bf740e7eee6775c8fe582aa4.jpg)  
Model 1   
Frame1

![](images/e98e0cbc7b23f48ef144a53819a88cbb401c6a40fd652c7fd8623c0ab78c3e40.jpg)  
Frame2

![](images/7aa9a28b8879768d43aac1e707e8b7400613763a14a55534e90a15b87d9fa7ed.jpg)  
Frame3

![](images/ddf3ba956a1d0a6c5f290207880ed9fc11b42904be4ae7274ed67ebcc9d0544e.jpg)  
Frame4

![](images/1c39ac015534339f83619b2f127a7039723bb514b11866779df3b4d16b0014af.jpg)  
Model 2   
Frame1

![](images/72cd5dda1dce847c5349f41cd9a7d2ac4c36db7ffeb489e3775522a9173e60ae.jpg)  
Frame2

![](images/5331464d496ff4e7516264ab350d9ef97db40633e7af1e46eec06720fac9c064.jpg)  
Frame3

![](images/5678b6bbff78039807beaa9de46d2b259b27addbdfb87368458d29fe42219e6d.jpg)  
Frame4

![](images/812ee269110dbba3746df856b0591d4b7653ab9490c5bbcfed253b6e21de5fd9.jpg)  
Reference images (ground truth)   
Frame1

![](images/f742a2cab3393ec76abbcf9bba92ab987a84a52850bdef187ce2d28d3e3325d0.jpg)  
Frame2

![](images/9f9128c0e5270f1e51b55653014880e48e4c794f0996aab3d46b979b14f0da90.jpg)  
Frame3

![](images/970e9fa3907ba802858cea6661b6c63d287a65c89013c92fec6652711556493c.jpg)  
Frame4   
Figure 8. Human study interface.

Visual Quality: Which model produces a story with better visual quality (high fidelity and less bluriness)?

![](images/be7aa889d42588267cae6aeebfa8c3d1001bd8619ad37864562e22b2e0d02ff1.jpg)  
odel 1

![](images/3f430ab8ceec783e60bde3db255feff96eebf230ab11f1aab5b42a08f9a505ff.jpg)  
Model 2

Semantic alignment: Which model generates images better align with the provided text descriptions?

![](images/40575fa91af95ed2b444a12c61a2b25497175108bbc7e819fce5425518fcc986.jpg)  
odel 1 M

![](images/c4f34b25c949b4be06a043d4d1bdc8683a3bd29f7a0195bcf13643e1f9c3b46e.jpg)

Temporal consistency: Which model produces a story with more consistent characters, environmental objects across four frames?

![](images/be90a33405bb052ccf6fbb8bed4eda5fe90a88e46174408a90a13e422fc6a4ae.jpg)  
odel 1

![](images/8671f1748c2502a60bdd276433aea0a0c705d73de445d56137ce46e903e37b9f.jpg)  
odel 2

Character accuracy: Which model produces characters that better match the character names mentioned in the captions for each frame?

You should also take references 'he,' 'she,' or 'they' into consideration.

(Pleases compare with the ground truth images above if you're unfamiliar with the character's name.)

![](images/84f45586224f51a3d28496e2e42a6d7b399a683e681e70e0823ae6d0944cca52.jpg)  
odel 1

![](images/c813ab6535f903439a7dde45685fa9bf664918b96046f5674a0b551a03689af8.jpg)  
odel 2

# D. Implementation Details

# D.1. Data preparation

FlintstonesSV [12] provides the bounding box location of each character in the image. We fed the bounding boxes into SAM [17] to obtain the segmentation map of corresponding characters. This offline supervision from SAM [17] is efficiently obtained without the need for manual labeling efforts. Furthermore, we enhance the original datasets from resolution of $128 \times 128$ to $512 \times 512$ via a super-resolution model and then we proceed to train and evaluate all models on this enhanced dataset.

# D.2. Extending dataset with referential text

We follow Story-LDM [38] to extend the datasets with referential text by replacing the character names with references, i.e., he, she, or they, wherever applicable as shown in Algorithm 1. The statistics before and after the referential extension are shown in Table 11. Please refer to Story-LDM [38] implementation<sup>9</sup> for more details on how the referential dataset is extended.

Table 11. Dataset statistics of FlintstonesSV [12] and PororoSV [22]   

<table><tr><td>Dataset</td><td># Ref (avg.)</td><td># Chars</td><td># Backgrounds</td></tr><tr><td>FlintstonesSV [12]</td><td>3.58</td><td>7</td><td>323</td></tr><tr><td>Extended FlintstonesSV</td><td>4.61</td><td>7</td><td>323</td></tr><tr><td>PororoSV [22]</td><td>1.01</td><td>9</td><td>None</td></tr><tr><td>Extended PororoSV</td><td>1.16</td><td>9</td><td>None</td></tr></table>

# D.3. First stage training

We built upon pre-trained Stable Diffusion [41] v1-5 $^{10}$ and use CLIP [35] ViT-L to extract characters' visual features. We freeze the CLIP text encoder and fine-tune the remaining modules for 25,000 steps with a learning rate of 1e-5 and batch size of 32. The first stage utilizes solely the original text description without extended referential text. To enhance inference time robustness and flexibility, with or without reference images, we adopt a training strategy that includes $10\%$ unconditional training, i.e., classifier-free guidance [14], $10\%$ text-only training, and $80\%$ augmented text training, which integrates visual features of characters with their corresponding token embeddings.

# D.4. Second stage training

We use OPT-6.7B $^{11}$ model as the LLM backbone in all experiments in the main paper. To expedite the second stage alignment training, we first pre-compute non-referential fused embeddings residing in the input space of the first-stage Char-LDM. We map visual features into $m = 4$ token embeddings as LLM input, set the max sequence length as 160 and the number of additional [IMG] tokens as $R = 8$ , batch size as 64 training for 20k steps. Llama2 is only trained for the experiments highlighted in the supplementary materials, demonstrating its capability for multi-modal generation and the ablation of different LLMs. The training configuration is almost the same as OPT, except for batch size 32. All experiments are executed on a single A100 GPU.

Please refer to all the details at the source code.

Algorithm 1 Character Replacement Algorithm   
Definitions:  
i: index for frames, ranging from 1 to $N$ $S_{i}$ : text description of frame $i$ $\mathcal{C}_i$ : a set contains immediate character(s) in the current frame  
for $i \in \{1,2,\dots,N\}$ do  
if $i = 1$ then $\mathcal{C}_i \gets$ immediate character of $S_{i}$ else  
if $\mathcal{C}_i \subseteq \mathcal{C}_{i-1}$ then  
if length( $\mathcal{C}_i$ ) = 1 then  
Replace $\mathcal{C}_i$ in $S_{i}$ with "he" or "she"  
else if length(c) > 1 then  
Replace $\mathcal{C}_i$ in $S_{i}$ with "they"  
end if  
end if $\mathcal{C}_i \gets \mathcal{C}_{i-1}$ end if  
end for

![](images/2cbb4bf96e5d38c8fc639affb5bed0332bed7a476cd5f7e85a74be6d2c98dc9c.jpg)  
Figure 9. DALL-E 3 [30] zero-shot inference on FlintstonesSV [12] dataset.

# E. Limitations

Our method demonstrates proficiency in resolving references and ensuring consistent character and background conditions in the context provided by guiding the output of a multi-modal Large Language Model (LLM) with character-augmented semantic embedding. However, several limitations remain. The process involves feeding the previously generated frame into the LLM to produce a visual output that aligns with the Latent Diffusion Model (LDM) input conditional space. This approach guarantees semantic consistency, enabling the generation of characters and environmental objects that resemble their originals. Nonetheless, there are minor discrepancies in detail. This is because the visual output from the Large Language Model (LLM) is aligned with the semantic embedding space rather than the pixel space, which hinders the complete reconstruction of all elements in the input image. However, the current most powerful multi-modal LLM, i.e., DALL-E 3 [30], could not solve this exact appearance replication in the multi-round image generation task (Figure 9), indicating an area ripe for further exploration and research.

# F. Qualitative Results

We provide more generated samples on FlintstonesSV [12] and PororoSV [22] with referential text as Figure 10-19 show.

![](images/686f6b3901269d75d71669f9e34c4b1bb7e086267721e45598f8a984c400f8ea.jpg)  
Figure 10. Qualitative comparison on FlintstonesSV [12] with co-reference descriptions.

![](images/74ec3c635b8b00837f53bdc5eb536505e9d255f9108717ff50b25727546e5c5a.jpg)  
Figure 12. Qualitative comparison on FlintstonesSV [12] with co-reference descriptions.

![](images/f78387947536bb5992bb357aa754ac0e7ad8a4caf660863cfbc37dcc1d28df59.jpg)  
Figure 11. Qualitative comparison on FlintstonesSV [12] with co-reference descriptions.

![](images/e69f3f6f24dfb7872b096d860e941f50248ddb0b20bad2af04566a6cc2bc8b25.jpg)  
Figure 13. Qualitative comparison on FlintstonesSV [12] with co-reference descriptions.

![](images/1e4e6c02a9ffcd04afb03abcaaa310cf188b482c6656b470fef768092e230a98.jpg)  
Figure 14. Qualitative comparison on FlintstonesSV [12] with co-reference descriptions.

![](images/1bdc4f78c35c251de28173751c9812f5c6d33670fcd853f48f770d3d22ecf638.jpg)  
Figure 16. Qualitative comparison on FlintstonesSV [12] with co-reference descriptions.

![](images/e34bc96ba84bf7f2ba86f034e445051e0229d142b5292881338f516939857af3.jpg)  
Figure 15. Qualitative comparison on FlintstonesSV [12] with co-reference descriptions.

![](images/d8bfd007e8cc629137dea3acedd6b55e5c8699d0263ed8b3230ad76108f27c53.jpg)  
Figure 17. Qualitative comparison on PororoSV [22] with coreference descriptions.

![](images/1b062fdfcb21db478c371f6299885051a0b6398443ad308043eecacca10ec648.jpg)  
Figure 18. Qualitative comparison on PororoSV [22] with co-reference descriptions.

![](images/b4106b4092f2be83b1484b6670500d1906625da8c23b33bb22db8c76b55b95c8.jpg)  
Figure 19. Qualitative comparison on PororoSV [22] with coreference descriptions.
