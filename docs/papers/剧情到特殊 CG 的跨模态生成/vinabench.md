# VinaBench: Benchmark for Faithful and Consistent Visual Narratives

## Silin Gao1, Sheryl Mathew1*,*3, Li Mi1, Sepideh Mamooler1, Mengjie Zhao2, Hiromi Wakaki2, Yuki Mitsufuji2, Syrielle Montariol1, Antoine Bosselut1

1EPFL, Switzerland 2Sony Group Corporation, Japan 3Carnegie Mellon University, USA

***Discourse Constraints***

![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)

Global Features

***Profile of Characters:***

***Profile of Characters Appearance Style***

* Samantha: adult female, wife
* Leo: adult male, husband

***Appearance Style:*** photorealistic

Scene Features

***Characters Time of Day***

***Location***

***Characters:*** Samantha ***Time of Day:*** afternoon ***Location:*** kitchen

***Characters:*** Samantha ***Time of Day:*** afternoon ***Location:*** kitchen

***Characters:*** Leo

***Time of Day:*** evening

***Location:*** hallway

***Characters:*** Leo, Samantha ***Time of Day:*** evening ***Location:*** dining table

Visual Narrative

***VinaBench***

Textual Narrative

**Samantha** was **cooking**

dinner at home.

(a)

She **washed the utensils** Her husband **Leo** came back They had **dinner** together while after **cooking**. with **bad news**. **Leo** said that he was **fired** today.

(b) (c) (d)

Image Captions

***Image Captions***

A **woman** wearing a green shirt is standing in a **kitchen**, wiping her hands with an **apron** tied around her waist. The **kitchen** is well-equipped with a sink …

A **woman** wearing an **apron** is standing in a **kitchen**, **washing** a **bowl** at a **sink**. The sun shines through the window on her face …

A **man** is standing in a hallway, wearing a suit and tie. He has a **sad expression** on his face. The hallway leads to a door …

A **man** and a **woman** are sitting at a **dining table**. The man is wearing a suit and tie, while the woman is wearing a shirt. The man is talking with **serious expression** …

Links

***Commonsense Links***

**woman – Samantha kitchen – cooking apron – cooking**

**woman – Samantha apron – cooking**

**…**

**sink – washed the utensils**

**man – Leo**

**sad expression – bad news**

**man – Leo**

**woman – Samantha dining table – dinner serious expression – fired**

***Commonsense Constraints***

Figure 1. **Overview of VinaBench.** We augment existing visual-textual narrative pairs with *discourse and commonsense constraints*, to promote the learning of consistent and faithful visual narrative generation and its evaluation. The *commonsense constraints* consist of links that ground the visual entities (extracted from image captions) to their associated textual narrative entities, as labeled by the phrases paired with the same color. The *discourse constraints* include scene-specific narrative features that trace the dynamics of basic narrative elements, *i.e*., characters, time and location, and global narrative features that describe static character attributes and image appearance style.

## Abstract

arXiv:2503.20871v3 [cs.CV] 3 Apr 2025

*Visual narrative generation transforms textual narra- tives into sequences of images illustrating the content of the text. However, generating visual narratives that are faithful to the input text and self-consistent across generated images remains an open challenge, due to the lack of knowledge constraints used for planning the stories. In this work, we propose a new benchmark, VinaBench, to address this chal- lenge. Our benchmark annotates the underlying common- sense and discourse constraints in visual narrative sam- ples, offering systematic scaffolds for learning the implicit strategies of visual storytelling. Based on the incorporated narrative constraints, we further propose novel metrics to closely evaluate the consistency of generated narrative im- ages and the alignment of generations with the input textual*

*narrative. Our results across three generative vision mod- els demonstrate that learning with VinaBench’s knowledge constraints effectively improves the faithfulness and cohe- sion of generated visual narratives.*[1](#_bookmark3)

## Introduction

Human narratives are often transformed from text into vi- sual media, *e.g*., in the film and television industries, scripts written by screenwriters are usually visualized as story- boards by art designers, to assist the filming of movies and TV series. However, translating textual narratives to sequences of images requires addressing two fundamental

1We release our data and code to the community, our project page:

<https://silin159.github.io/Vina-Bench>

challenges: *narrative alignment* and *visual consistency*.

First, as textual narratives are often abstract and visually under-specified, visual narrative generation models must in- fer relevant commonsense knowledge to manifest relevant and coherent visual content. For example, in Frame (c) of Figure [1](#_bookmark1), the phrase *bad news* in the textual narrative is vi- sually interpreted as a *sad expression* on the husband Leo’s face. This visual interpretation of the character’s state of mind is not explicitly mentioned in the textual narrative, demonstrating the **manifestation gap** between the input textual narrative and output visual narrative. Second, visual narratives possess discourse features [[4](#_bookmark35), [5](#_bookmark36)], *i.e*., narrative elements such as characters and locations, that may be con- nected across different images of the visual narrative. For instance, Figure [1](#_bookmark1) (a) and (b) are closely connected in the vi- sual discourse, where the basic settings of the scene remain the same, *i.e*., Samantha staying in a kitchen. Visual narra- tive generation models must plan such visual discourse, and be consistent in how these various features are manifested.

However, previous methods typically do not explicitly address these challenges for visual narrative generation [[25](#_bookmark56), [31](#_bookmark62), [33](#_bookmark64), [50](#_bookmark81)], and instead simply learn to map text nar- ratives directly to visual narratives. Consequently, they do not model the necessary commonsense knowledge for pro- ducing visual manifestations from the narrative context, and are therefore prone to generate images that are not faithful to the narrative. They also fall short of learning the consis- tency constraints in visual narrative discourse, often gener- ating image sequences with inconsistent character appear- ances, background location, or time period.[2](#_bookmark5)

In this work, we propose a benchmark to address the aforementioned challenges in visual narrative generation, which augments visual narrative exemplars with common- sense and discourse constraints, as illustrated in Figure [1](#_bookmark1). Our **Vi**sual **na**rrative **Bench**mark, **VinaBench**, contains

∼25K pairs of visual and textual narratives sampled from

diverse visual storytelling datasets [[10](#_bookmark41), [25](#_bookmark56), [45](#_bookmark76)]. VinaBench also contains commonsense links that bridge the manifes- tation gap between textual and visual narratives, which enables better learning of their commonsense alignment. Specifically, the fine-grained content in visual narratives is first extracted as image captions, whose entities (noun or verb phrases) are then linked to their associated textual narrative entities. Moreover, VinaBench annotates a set of global and scene-specific features to explicitly reveal the vi- sual discourse. The global features describe the static at- tributes of characters and the image appearance style. The scene (per image) features trace the dynamics of basic nar- rative elements, including presented characters, time of day and location. These discourse features promote visual nar- rative consistency, and the alignment of scene dynamics to narrative progression.

2as verified by our analysis in §[6](#_bookmark17)

Our benchmark evaluation uses commonly-adopted met- rics for matching generated visual narrative images to gold references, based on Frechet inception distance [[9](#_bookmark40)], or CLIP

[[35](#_bookmark66)] similarity score of the two modalities, etc. However, these metrics may be biased to specific reference images, which are not the only feasible visual manifestations of their corresponding narrative, *e.g*., the woman in Figure [1](#_bookmark1) (a) was not necessarily wearing a green shirt. To address this limitation, we also propose a novel set of evaluation met- rics for visual narrative generation that highlights the con- sistency and manifestation assessment of key narrative el- ements, labeled by our constructed visual discourse and commonsense constraints. Our proposed metrics are either reference-free or based on ranking a pool of sampled image candidates, mitigating the impact of single reference com- parisons that might skew the evaluation to irrelevant details. Using these new resources, we test several representa- tive visual narrative generation models [[25](#_bookmark56), [33](#_bookmark64), [43](#_bookmark74)] on Vin- aBench. Our results on all models consistently show that learning with our constructed discourse and commonsense constraints significantly augments the visual narrative con- sistency and alignment to the input textual narrative. How- ever, all of our tested models still have large room for im- provement when comparing to human-crafted references, which calls for further research on developing better visual

narrative generation methods.

## Background and Related Work

**Visual Narrative Generation** Transforming textual nar- ratives into image sequences requires manifesting visual el- ements that are implied, though rarely explicitly stated, over the course of storytelling, which is essential for understand- ing and generating longer videos [[22](#_bookmark53), [45](#_bookmark76)]. More intuitive visual illustrations also benefit the education of complex real-world concepts, and contribute to the childhood devel- opment of intelligence, imagination and creativity [[7](#_bookmark38), [42](#_bookmark73)].

Current visual narrative generation methods [[25](#_bookmark56), [31](#_bookmark62), [33](#_bookmark64),

[50](#_bookmark81)] mostly rely on pre-trained vision transformers [[21](#_bookmark52), [35](#_bookmark66),

[36](#_bookmark67)] and diffusion modules [[37](#_bookmark68), [39](#_bookmark70), [40](#_bookmark71)] to model direct textual-to-visual narrative mapping, which often fall short of learning the underlying commonsense and discourse con- straints of this task. Although prior works [[2](#_bookmark32), [18](#_bookmark49), [30](#_bookmark61)] have stepped into the commonsense augmentation and alignment in visual story generation, they are limited to simple phys- ical commonsense in ConceptNet [[41](#_bookmark72)] and general word or token-level semantic alignment with image regions, which overlooks more in-depth commonsense alignment between textual and visual expression manners.

Besides, the image sequences commonly studied in vi- sual narrative generation are formed by either photos from different origins [[13](#_bookmark44)], or video shots from a single cartoon [[22](#_bookmark53), [30](#_bookmark61)], which only cover pseudo or monotonous visual narrative cases. As more real and diverse visual narrative

data resources [[10](#_bookmark41), [25](#_bookmark56), [45](#_bookmark76)] recently emerge, our work aims to annotate the commonsense and discourse constraints im- plied in these visual narrative resources, and provide bench- mark methods of augmenting visual narrative generation with our incorporated constraints.

**Visual-Linguistic Alignment** Linking visual data with its natural language correspondence contributes to robust modeling of world visual concepts [[35](#_bookmark66)], which promotes the advancement of various vision-language applications, *e.g*., visual question answering [[1](#_bookmark33)], visual dialogue [[6](#_bookmark37)], and visual storytelling [[13](#_bookmark44)]. Due to the need for more re- fined vision understanding in the above applications, fine- grained visual-linguistic alignment techniques are studied, *e.g*., matching visual scene graphs with linguistic structures [[32](#_bookmark63), [44](#_bookmark75)], aligning image patches with text tokens or physi- cal knowledge graphs [[20](#_bookmark51), [30](#_bookmark61), [46](#_bookmark77)], etc. Different from prior works, we focus on more implicit commonsense alignment between visual expressions and textual descriptions, in the context of visual narrative generation.

**Visual Narrative Structure** Natural language possesses syntactic structures [[17](#_bookmark48)], *i.e*., words in a sentence have their lexical categories, *e.g*., Noun (N), Verb (V), etc., and can be further grouped into higher-level phrases such as Noun Phrase (NP), Verb Phrase (VP), etc. Similarly, visual nar- ratives also possess structures [[4](#_bookmark35)], where images in a visual narrative can be mapped into five categories according to the tension of the narrative, including Establisher (E), Ini- tial (I), Prolongation (L), Peak (P) and Release (R). These categories then form phases of constituency, *e.g*., a canon- ical constituency phase consists of a linear order of the categories E-I-L-P-R. Based on the above structure, a vi- sual narrative can be divided into discourse segments [[5](#_bookmark36)], whose boundaries are determined by the start and end of the narrative’s constituency phases. The discourse segments feature the dynamics of narrative elements across differ- ent images (or scenes), *i.e*., typically the persistence and change of characters, time and spatial location, which are the key information intuitively perceived by narrative view- ers [[28](#_bookmark59), [29](#_bookmark60), [48](#_bookmark79)]. In this work, we aim to concretize the dis- course dynamics of visual narratives, and study how they enhance the consistency of visual narrative generation.

**Visual Consistency Evaluation** Related to our focus on visual narrative consistency, research on video generation [[14](#_bookmark45), [23](#_bookmark54)] raises the evaluation of semantics and style con- sistency, w.r.t. attributes and spatial relationships of objects, actions of characters, temporal and appearance style, etc. Different from video consistency which focuses more on the short-time spatial-temporal coherence, our work is more concerned with the long-time visual element consistency throughout the narrative discourse.

**Global Discourse Features**

![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)

**Llama-3.1-70B-Instruct**

**Llama-3.1-70B-Instruct**

**MiniCPM-V-2.6**

Samantha Leo

Samantha: adult female, wife Leo: adult male, husband

photorealistic

…

…

Samantha washed the utensils after cooking. **(a)**

Her husband Leo came back with bad news. **(b)**

**Scene Discourse Features**

**Image Captions**

**Commonsense Links**

**LLaVA-OneVision-72B Mantis-Idefics2 Llama-3.1-70B-Instruct**

A woman wearing a woman → Samantha

green shirt … green shirt → (none) …

Samantha afternoon kitchen

Figure 2. **Overview of VinaBench data construction pipeline.** We use hybrid VLMs and LLMs to annotate the discourse features and commonsense links underlying visual-textual narrative pairs.

## VinaBench Data Construction

VinaBench samples visual-textual narrative pairs from three advanced visual storytelling datasets, Visual Writing Prompts (VWP) [[10](#_bookmark41)], Storyboard20K [[45](#_bookmark76)] and StorySa- lon [[25](#_bookmark56)], which cover diverse characters and scenes. Us- ing these datasets as a foundation, as illustrated in Fig- ure [1](#_bookmark1), we augment the visual-textual narrative pairs with commonsense and discourse constraints. These constraints highlight the alignment between visual and textual narra- tive manifestations, and the consistency of basic elements expressed in the visual narrative. Figure [2](#_bookmark8) summarizes our components for constructing commonsense and discourse constraints given a visual narrative.

### Commonsense Constraints

Commonsense constraints are entity links that ground the visual details in narrative images to their relevant textual narrative phrases, *e.g*., the woman in Figure [2](#_bookmark8) (a) is linked to the character Samantha. We extract the commonsense entity links in three steps:

First, we use dense captioning [[16](#_bookmark47)] to extract visual de- tails in each narrative image. We prompt Mantis-Idefics2

[[15](#_bookmark46)] to generate the dense captions, which achieves out- standing performance among various VLMs [[27](#_bookmark58), [34](#_bookmark65), [47](#_bookmark78), [51](#_bookmark82)] in our pilot study. We input each narrative image with its textual narrative description as context, which effectively prevents the model from generating hallucinated details in the dense caption that contradict the textual narrative. For instance, in Figure [2](#_bookmark8) (a), without knowing the textual nar- rative, the model may conclude that the woman is stirring food in the bowl, instead of washing the bowl.

Second, we extract visual entities in the generated dense caption of each narrative image. We prompt Llama3.1-70B- Instruct (Llama3.1) [[8](#_bookmark39)], a powerful open source LLM, to

perform the extraction, where the target visual entities are scoped to noun or verb phrases presented in the caption.

Finally, for each visual entity extracted from the image caption, we find its potential commonsense link to the enti- ties (noun or verb phrases) in the textual narrative. In par- ticular, we present Llama3.1 with the textual narrative and the visual entity contextualized by its source image caption, and prompt the model to find an entity from the narrative that is associated with the visual entity. For visual entities that do not link to any entity in the textual narrative, *e.g*., *green shirt* in the image caption of Figure [2](#_bookmark8) (a), we instruct Llama3.1 to output an empty link *“no link”*.

### Discourse Constraints

We parse a group of global and scene-specific features to represent discourse constraints for each narrative. Our an- notated features identify discourse concepts from previous studies of visual narrative structure [[4](#_bookmark35), [5](#_bookmark36)], and also consider- ations for style consistency [[14](#_bookmark45)], as described in Section [2](#_bookmark6). Below, we introduce the frame and construction of our dis- course features.

**Frame** We annotated two varieties of global features:

* + - **Character Profiles** includes the full list of characters in- volved in the narrative. Each character is indexed by his or her name (if the name is not mentioned, a role pronoun such as *man* or *woman* is used instead), and described by basic attributes including age range (*e.g*., *young adult*, *child*), gender (*male* or *female*), social role (*e.g*., *husband*, *Tom’s close friend*), and other sustained physical features (*e.g*., *badly hurt*). Basic character attributes are expected to remain static over the course of narrative.
    - **Appearance Style** describes the style [[14](#_bookmark45)] of the visual narrative, *e.g*., *photorealistic*, *fantasy art*, *digital art*, *pop art*, *comic book*, *cartoon*, *surrealistic* and *black and white photographic*. Most visual narratives typically maintain a consistent appearance style across narrative images. If the images of a visual narrative are found to have multiple styles, this label will be annotated as *not unified*.

The scene-specific features of each image in the visual nar- rative consist of three components:

* + - **Characters** that are presented in the image, whose ap- pearances are expected to align with their descriptions in the global profile. A character’s appearance typically re- mains consistent across images where they are presented.
    - **Time of Day** indicates the period of day during which the scene occurs, including *early morning*, *morning*, *after- noon*, *evening* and *night*, which may shift as the narrative progresses. The time of day is labeled as *unclear* if it is ambiguous in the scene (*e.g*., if the scene is indoors).
    - **Location** describes where the scene takes place, *e.g*., *kitchen*, *restaurant*, *outdoor road*, etc., or *unclear* if am- biguous, which may also change dynamically during the

narrative. Images that are labeled with the same location are expected to have consistent spatial background.

**Construction of Discourse Features** We construct the global character profile in two steps. We first prompt Llama3.1 to identify all characters in the narrative. We in- put the entire textual narrative, and instruct the model to output a list of character names (or role pronouns) involved in the narrative. Based on the identified character list, we then prompt the Llama3.1 to parse the basic attributes of each character in the list, given the entire textual narrative as context. Note that we do not include the visual narrative or its captions in the context, to prevent the model from gener- ating visual details that are not static or necessary attributes of the character, *e.g*., the woman *Samantha* in Figure [1](#_bookmark1) (a) has golden curly hair.

Based on the global character profile, we then label the presented characters in each scene, using a fine-grained two-step prompting strategy. For each image in the visual narrative, we first prompt LLaVA-OneVision-72B (LLaVA- OV) [[19](#_bookmark50)], an advanced VLM with robust fine-grained multi- modal reasoning performance, to detect the number of char- acters in the image. With the character number, the model is then instructed to further specify the detected characters’ indexes (names or role pronouns) in the global profile, by matching their attributes to the content of the image and its corresponding textual description. We also input the previ- ous textual narrative as context, to resolve the issue of co- reference, *e.g*., *“Her”* in Figure [2](#_bookmark8) (a) refers to *Samantha’s*. For the rest of discourse feature labels, we simply prompt LLaVA-OV to annotate the time of day and the location of each image in the narrative, given the image’s corre- sponding textual description as context. And we prompt MiniCPM-V-2.6 [[47](#_bookmark78)], an advanced VLM optimized for multi-image understanding, to judge the image appearance

style of the entire visual narrative.

### Expert Study

One question that naturally arises is whether the LLMs and VLMs used constructing VinaBench accurately annotated the constraints of visual narrative samples. To evaluate this, 12 experts manually check the labels of commonsense and discourse constraints of 100 narrative samples in Vin- aBench. For each narrative sample, the experts first check whether its global discourse features appropriately depict the attributes of characters in the narrative and the appear- ance style of the narrative images. Then, for a specific scene randomly selected from the narrative sample, the experts check whether its (scene-specific) features correctly label its presented characters, time of day and location, and whether its image caption and commonsense links reasonably de- scribe its image content and associations to its textual nar- rative description, respectively. Each narrative sample is

**Rate (%) Sty. Attr. Cap. CL Pre. Time Loc. Accept** 95.5 91.1 85.0 86.6 84.5 89.0 93.0

**Disagree** 3.0 5.0 8.0 6.0 6.0 8.0 4.0

Table 1. Expert study on the accuracy of commonsense and dis- course constraints labeled in VinaBench, including appearance style (**Sty.**), character attributes (**Attr.**), image caption (**Cap.**), commonsense links (**CL**), presented characters (**Pre.**), time of day (**Time**) and location (**Loc.**). Experts’ average acceptance rate (**Accept**) and percentage of disagreement (**Disagree**) are reported.

checked by two experts, and we report their average rate of accepting the labels as correct or appropriate, with the percentage of their disagreements.

Table [1](#_bookmark13) shows the results of our expert study. We ob- serve high acceptance rates for all types of constraint la- bels, each with fairly low rates of disagreement between the experts. These results verify that VinaBench construction scheme using large language and vision models is reliable for annotating accurate visual narrative constraints, which saves the labour of human annotators.

## VinaBench Evaluation

Prior work in visual narrative generation [[25](#_bookmark56), [31](#_bookmark62), [33](#_bookmark64), [50](#_bookmark81)] evaluated models on full-reference metrics, *e.g*., FID [[9](#_bookmark40)], which directly match model generations to gold reference images. However, the visual expression of a narrative is always open-ended, *i.e*., not limited to a single reference. Therefore, model generations that do not match references may receive lower scores, but still be acceptable manifesta- tions of the textual narrative. For example, in Figure [1](#_bookmark1) (a), the model could visualize the woman with black hair instead of golden hair and remain faithful to the textual narrative. StoryGen [[25](#_bookmark56)] moved beyond reference images by checking CLIP [[35](#_bookmark66)] text-image similarity (CLIP-T) between model generations and the input textual narrative. However, the mapping from CLIP similarity to the level (or rank) of align- ment may vary across various narrative samples, *e.g*., if the input text is concise or under-specified, a vague similarity with CLIP-T 0*.*6 may already indicate an outstanding level of alignment, while for relatively detailed input text, a high similarity with CLIP-T 0*.*9 may be the outstanding bar in- stead. Importantly, neither of the above metrics evaluates visual narrative consistency. Instead, they individually eval- uate each generated image in the visual narrative, ignoring the inter-connections between different images, which re- mains assessed solely through human evaluation [[25](#_bookmark56)].

Motivated by these shortcomings, we propose novel evaluation metrics to assess **visual-textual narrative align- ment** and **visual narrative consistency**. In particular, we design a *ranking-based* metric (instead of fixed-range scor- ing) to measure more intuitive and uniform level of align-

ment between visual narrative generations and textual nar- rative inputs. Based on our constructed commonsense and discourse constraints in Sec. [3](#_bookmark9), we further build a series of VQA-based [[24](#_bookmark55)] metrics to assess the *fine-grained align- ment* between visual generations and narrative constraints, and also the *consistency* of visual narrative generations. All of our metrics prevent the biases of directly comparing to a single reference image. We describe our metrics below.

### Alignment Ranking

We define a function *f* (·*,* ·) ∈ [0*,* 1] to measure the pairwise alignment between an image and a textual description. We test two implementations of the function, including CLIP

[[35](#_bookmark66)] text-image embedding cosine similarity (CLIP-T), and VQAScore [[24](#_bookmark55)] where we ask LLaVA-OneVision-72B [[19](#_bookmark50)] whether the image is aligned with the textual description (only answer *Yes* or *No*), and record the probability of the model outputting *Yes* as its first decoded token.

For each scene, we use our defined function to sample top-100 images that have the highest alignment score with the input textual narrative, from the entire pool of images in the test set. We then use the same function to score the alignment of the generated image with the input textual nar- rative, and use this score to obtain the generated image’s ranking in the pool of sampled top-100 images. For each model, we report the mean reciprocal rank (MRR) of its generated images across all scenes in the test set. We denote our ranking metrics as **CLIP-T-MRR** and **VQA-MRR**, for CLIP-T and VQA-based ranking function, respectively.

### Fine-Grained Alignment

We develop five metrics to measure the fine-grained align- ment of each generated image with its corresponding scene’s narrative constraints constructed in VinaBench.

* + - **Non-Character**: For each essential non-character entity in the scene’s textual narrative, *i.e*., phrase that is linked in Sec. [3.1](#_bookmark10) but not included in the global character pro- file in Sec. [3.2](#_bookmark12), we prompt a VLM to judge whether the generated image contains or implies the phrase.
    - **Character Number**: We prompt a VLM to check whether the number of characters in the generated image matches the number of presented characters indicated by the scene’s discourse feature.
    - **Character Attribute**: Given the scene’s presented char- acters and their attributes in the global profile, we instruct a VLM to check whether characters depicted in the gen- erated image fit into the given attributes.
    - **Time of Day**: If the time of day is not labeled as *unclear* in the scene’s discourse feature, we instruct a VLM to judge whether the image is taken during the labeled time.
    - **Location**: We instruct a VLM to judge whether the image is taken at the location labeled in the scene’s discourse feature, if it is not *unclear*.

### Consistency

For each narrative sample, we design three metrics to assess the consistency of generated visual narrative images, based on our constructed features for the discourse constraints.

* + - **Style**: We prompt a VLM to judge whether all generated images in the narrative sample have the same appearance style. Note that the appearance style of generated images does not necessarily need to match the style labeled in the global discourse features, since the input textual narrative typically does not provide a constraint for image style.
    - **Character**: For each character in the global profile, if he or she is presented in multiple scenes according to the scene-specific discourse features, we instruct a VLM to check whether the generated images for those multiple scenes all show that same character.
    - **Location**: If multiple scenes possess the same location label in the scene-specific discourse features, we prompt a VLM to check whether the generated images for those multiple scenes are all taken at that same location.

For each fine-grained alignment and consistency metric, we follow VQAScore [[24](#_bookmark55)] to report the average probability of the VLM outputting *Yes* as its first decoded token (the VLM is instructed to only answer *Yes* or *No*), under the zero-shot setting. To ensure that our metrics are not biased on a spe- cific VLM’s preference, we run on two VLMs, MiniCPM- V-2.6 [[47](#_bookmark78)] and LLaVA-OneVision-72B [[19](#_bookmark50)], and confirm that the results given by the two VLMs are aligned.

## Experimental Methods

We evaluate various baseline visual narrative generation methods on VinaBench, based on a variety of task settings, models and metrics described below. We consider three set- tings to investigate augmenting the visual narrative genera- tion model with the narrative constraints in VinaBench.

* **No Constraint**: We first test a vanilla setting where the vision model is trained to generate the visual narrative images given only the textual narrative.
* **LLM Constraints**: We train a LLM, Llama3.1-70B- Instruct [[8](#_bookmark39)] with LoRA [[11](#_bookmark42)], to generate the constraints of each visual narrative scene, *i.e*., the scene’s image caption and its corresponding commonsense links and discourse features constructed in Sec. [3](#_bookmark9), based on the textual narra- tive. Then the vision model learns to generate the visual narrative images given the concatenation of textual narra- tive and LLM-generated constraints. To enable training the auto-regressive LLM as a narrative constraint genera- tor, we merge the commonsense links into the image cap- tion, and concatenate it with the serialized discourse fea- tures, *e.g*., the narrative constraints of Figure [1](#_bookmark1)(a) are se- rialized into *A woman (Samantha) wearing a green shirt*

*... [Characters] Samantha (adult female, wife) [Time of*

*Day] afternoon [Location] kitchen*.[3](#_bookmark18)

* **Gold Constraints**: We also test an oracle setting, where we replace the LLM-generated narrative constraints with our annotated gold constraints (with the same preprocess- ing of merging the commonsense links into the image caption and serializing the discourse features) at the in- ference phase.

We test three generative vision models that were optimized for visual narrative generation: ARLDM [[33](#_bookmark64)], StoryGen

[[25](#_bookmark56)] and MM-Interleaved (MM-Inter.) [[43](#_bookmark74)]. We include detailed information about the three vision models in our supplementary material. We evaluate model generations based on our proposed **Alignment** and **Consistency** metrics in Section [4](#_bookmark15), as well as previously reported metrics com- monly used for visual narrative generation: Frechet incep- tion distance (**FID**) [[9](#_bookmark40)], and CLIP [[35](#_bookmark66)] embedding similar- ity to the gold reference image (**CLIP-I**) and to the narrative text (**CLIP-T**).

## Experimental Results

We first train and test our baseline models on VinaBench’s VWP movie narratives, and then evaluate their zero-shot generalization to the Storyboard20K testing samples, which cover broader movie scenes and real movie synopses. We also train and test all models on VinaBench’s StorySalon an- imation narratives, whose images have far different styles compared to the images from VWP and Storyboard20K, and are sourced from YouTube videos and E-books that are not limited to movies.

### VWP and Storyboard20K Narratives

Table [2](#_bookmark20) shows the evaluation results on the VWP narra- tives of VinaBench.[4](#_bookmark19) We draw consistent conclusions on the three baseline models. In particular, we find that infer- ring the narrative constraints before generating the narra- tive images (LLM Constraints) significantly improves the alignment and consistency of visual narrative generation. This result suggests that the expressive gap between vi- sual and textual narratives can be significantly bridged by middle-stage visual narrative planning, showing the impor- tance of learning implicit visual narrative constraints, which can serve as an intermediate scaffold for visual narrative generation.

Interestingly, we find that the ranking scores (CLIP-T- MRR) of gold references (Gold Ref.) fall short of the maxi- mum score (1.0), confirming that textual narratives typically do not map to single feasible visual narrative counterparts, and that full-reference metrics for visual narrative genera- tion may be inadequate. However, the model-generated vi-

3Details of constraint preprocessing are in the supplementary material. 4We include the results of our ranking-based metric VQA-MRR and fine-grained VQA-based metrics using LLaVA-OneVision-72B in the sup-

plementary material, which indicate the same conclusions.

**Model Setting FID CLIP-I CLIP-T CLIP-T Alignment Consistency**

|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  | | | | | **-MRR** | **Ent.** | **Num.** | **Attr.** | **Time** | **Loc.** |  | **Sty.** | **Char.** | **Loc.** |  |
|  | **No Constraint** | 42.6 | 0.638 | 0.195 | 0.110 | 0.564 | 0.398 | 0.320 | 0.443 | 0.376 |  | 0.466 | 0.379 | 0.376 |  |
| **ARLDM** | **LLM Constraints** | **37.6** | **0.676** | **0.204** | **0.151** | **0.674** | 0.443 | 0.411 | **0.512** | 0.584 |  | 0.859 | 0.551 | 0.689 |  |
|  | **Gold Constraints** | 35.3 | 0.716 | 0.209 | 0.155 | 0.682 | 0.619 | 0.546 | 0.518 | 0.690 |  | 0.854 | 0.569 | 0.697 |  |
|  | **No Constraint** | 78.6 | 0.562 | 0.184 | 0.100 | 0.471 | 0.335 | 0.285 | 0.279 | 0.315 |  | 0.238 | 0.231 | 0.311 |  |
| **StoryGen** | **LLM Constraints** | 52.1 | 0.600 | 0.190 | 0.106 | 0.595 | 0.424 | 0.341 | 0.367 | 0.504 |  | 0.452 | 0.418 | 0.465 |  |
|  | **Gold Constraints** | 48.9 | 0.619 | 0.194 | 0.115 | 0.614 | 0.547 | 0.444 | 0.393 | 0.598 |  | 0.475 | 0.423 | 0.527 |  |
|  | **No Constraint** | 48.3 | 0.634 | 0.176 | 0.066 | 0.499 | 0.409 | 0.326 | 0.463 | 0.449 |  | 0.947 | 0.582 | 0.449 |  |
|  | **LLM Constraints** | 42.2 | 0.667 | 0.198 | 0.111 | 0.643 | **0.458** | **0.412** | 0.486 | **0.600** |  | **0.986** | **0.678** | **0.764** |  |

**MM-Inter.**

|  |  |  |  |  |  |  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| - **w/o CL** | 42.9 | 0.666 | 0.197 | 0.109 | 0.642 | 0.455 | 0.409 | 0.475 | 0.597 | 0.983 | 0.643 | 0.758 |
| - **w/o DF** | 43.3 | 0.657 | 0.196 | 0.107 | 0.624 | 0.449 | 0.401 | 0.474 | 0.564 | 0.978 | 0.644 | 0.684 |
| - **w/o GDF** | 42.6 | 0.665 | 0.197 | 0.110 | 0.642 | 0.450 | 0.407 | 0.484 | 0.597 | 0.978 | 0.649 | 0.760 |
| - **w/o SDF** | 42.6 | 0.663 | 0.196 | 0.109 | 0.634 | 0.449 | 0.411 | 0.477 | 0.574 | 0.979 | 0.673 | 0.685 |
| - **Random** | 53.7 | 0.614 | 0.174 | 0.048 | 0.415 | 0.399 | 0.318 | 0.412 | 0.412 | 0.945 | 0.576 | 0.447 |

|  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  | **Gold Constraints** | 39.3 | 0.698 | 0.200 | 0.118 | 0.652 | 0.623 | 0.546 | 0.497 | 0.728 | 0.976 | 0.688 | 0.856 |
| **Gold Ref.** | - | - | - | 0.208 | 0.159 | 0.776 | 0.813 | 0.758 | 0.756 | 0.863 | 0.971 | 0.780 | 0.863 |

Table 2. Evaluation results on **VWP** narratives. The displayed results of our VQA-based metrics are rooted on MiniCPM-V-2.6,

w.r.t. the **Alignment** of non-character entities (**Ent.**), character number (**Num.**), character attributes (**Attr.**), time of day (**Time**) and location (**Loc.**), and the **Consistency** of style (**Sty.**), character (**Char.**) and location (**Loc.**). *Gold Ref.* denotes gold references.

Best results with LLM Constraints and with Gold Constraints are **bolded** and underlined, respectively. Lower FID score is better.

**Model Setting Align. Sty. Cont. Char. Qual.**

|  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- |
| **ARLDM No Constraint** | 2.29  3.22 | 2.77  3.38 | 1.88  2.49 | 1.74  2.08 | 2.47  3.02 |
| **MM-Inter. No Constraint** | 2.43 | 4.20 | 3.68 | 2.81 | 3.23 |
| **LLM Constraints** | **3.32** | **4.49** | **4.03** | **2.95** | **3.42** |
| **Gold Ref.** - 4.68 4.89 4.82 4.72 4.80 | | | | | |

**LLM Constraints**

Table 3. Human evaluation results on VWP narratives, w.r.t. text- image alignment (**Align.**), style consistency (**Sty.**), content consis- tency (**Cont.**), character consistency (**Char.**) and image quality (**Qual.**). Best results (excluding Gold Ref.) are **bolded**.

sual narratives significantly lag the gold references on all metrics, indicating a large room of improvement.

Our human evaluation supports the results of our au- tomatic evaluation. 12 expert annotators evaluate the vi- sual narrative generations of ARLDM and MM-Interleaved models (with and without LLM generated constraints), along with the gold references, on 100 VWP testing sam- ples.[5](#_bookmark23) The annotators follow the methodology of StoryGen

[[25](#_bookmark56)] and use a Likert scale from 1 to 5 (higher is better) to rate the visual narrative’s **alignment** with input textual narrative, consistency of image **style**, non-character **con- tent** and **character** appearance, and general image **quality**. Our human evaluation results in Table [3](#_bookmark22) also validate that learning narrative constraints contributes to more faithful and consistent visual narratives. Moreover, the human pref-

5Model generations and the gold reference are randomly shuffled in the human evaluation of each narrative sample, and human annotators are bling to the source of each (generated or reference) visual narrative.

![](data:image/png;base64...)

![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)

![](data:image/png;base64...)

Figure 3. Pearson correlation coefficients between human and au- tomatic evaluation metrics on VWP narratives. **Alignment** and **Consistency** in automatic evaluation metrics denote the average of our VQA-based fine-grained alignment and consistency met- rics, respectively, rooted on MiniCPM-V-2.6.

erence towards different vision models is coherent with the preference given by our proposed metrics, where ARLDM generations are in general comparable with MM-Interleaved in terms of the alignment with input textual narrative, but significantly fall behind MM-Interleaved in terms of con- sistency. By contrast, FID, CLIP-I and CLIP-T scores show more preference to ARLDM than MM-Interleaved.

Figure [4](#_bookmark25) shows a case of visual narratives generated by MM-Interleaved, with and without narrative constraints. Compared to the model generation without constraints, the

![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)

**MM-Inter. (No Constraint)**

**MM-Inter. (LLM Constraints)**

**Gold Ref.**

Nicolas is threatening the Nicolas stares intently at the lab workers with a gun. beakers and flasks in the lab.

Nicolas turns away because he hears something behind him. He looks down.

Nicolas sees Keith is holding Nicolas shoots Keith, and a plastic gun pretending it is some beakers of chemicals real. Nicolas becomes upset. burst with smoke billows.

Figure 4. Visual narratives generated by MM-Interleaved with and without LLM-generated narrative constraints, and the gold reference.

generation with LLM constraints includes more details that are faithful to the textual narrative, *i.e*., depicting a lab back- ground and reasonable facial expressions of Nicolas accord- ing to the narrative. Consistent with our human evaluation in Table [3](#_bookmark22), however, the model generation significantly falls short of gold references w.r.t. character consistency, *e.g*., Nicolas’ outfit shifts between black and white.

|  |  |  |  |  |
| --- | --- | --- | --- | --- |
| **Model** | **Setting** | **FID** | **Alignment** | **Consistency** |
|  | **No Constraint** | 97.9 (55.4) | 0.295 (0.125) | 0.187 (0.220) |
| **ARLDM** | **LLM Constraints** | **82.6** (45.0) | **0.479** (0.046) | 0.488 (0.210) |
|  | **Gold Constraints** | 77.7 (42.5) | 0.566 (0.045) | 0.573 (0.135) |
|  | **No Constraint** | 161.4 (82.8) | 0.227 (0.110) | 0.186 (0.074) |
| **StoryGen** | **LLM Constraints** | 112.0 (59.9) | 0.375 (0.071) | 0.396 (0.049) |
|  | **Gold Constraints** | 107.7 (58.7) | 0.457 (0.063) | 0.447 (0.028) |
| **No Constraint MM-Inter. LLM Constraints** | | 102.4 (54.1)  95.7 (53.5) | 0.276 (0.153)  0.466 (0.054) | 0.553 (0.106)  **0.749** (0.060) |
| **Gold Constraints** | | 90.8 (51.5) | 0.556 (0.053) | 0.797 (0.043) |
| **Gold Ref.** - - 0.817 0.882 | | | | |

**Reliability of Evaluation Metrics** We more closely study the correlation of our automatic evaluation metrics to the five human evaluation metrics. In particular, we con- sider the average of our fine-grained alignment and consis- tency metrics, denoted as **Alignment** and **Consistency**, and compare them to the CLIP-based metrics CLIP-I and CLIP-

T. Using 100 VWP testing samples, we compute the Pear- son correlation coefficient between human and automatic evaluation scores for four methods[6](#_bookmark26) and the gold references. Figure [3](#_bookmark24) presents the results of our correlation study. Com- pared to CLIP-I and CLIP-T, Alignment and Consistency metrics demonstrate overall better correlation with human evaluation, verifying that our proposed VQA-based evalua- tion gives more reliable results than CLIP-based similarity measure.

**Generalization** For each model trained on VWP narra- tives, we also test its generalization performance to the Sto- ryboard20K narratives in VinaBench. We aggregate the generalization results in Table [4](#_bookmark28), and compare them with the evaluation results on VWP testing samples.[7](#_bookmark27) Compared to *No Constraint*, models augmented with narrative con- straints yield smaller drops on all metrics when general- izing from VWP to Storyboard20K narratives, which indi- cates those models’ more robust visual narrative capabil- ities on out-of-distribution samples, probably due to their

6We consider the four methods studied in the human evaluation, *i.e*., ARLDM with and without LLM constraints, and MM-Interleaved with and without LLM constraints.

7Full results on Storyboard20K are in the supplementary material.

Table 4. Zero-shot evaluation results on **Storyboard20K** narra- tives. All models are trained on VWP narratives. **Alignment** and **Consistency** denote the average score of our fine-grained align- ment and consistency metrics rooted on MiniCPM-V-2.6. Perfor- mance drops compared to the results on VWP narratives are in brackets. Other notations are same as Table [2](#_bookmark20).

learning of more generic visual narrative planning from the constraints.

**Ablation Study** In Table [2](#_bookmark20), we also conduct ablation study on the using MM-Interleaved with LLM Constraints, to more finely investigate the benefits of adding common- sense links and discourse features as visual narrative con- straints. Specifically, we individually remove the common- sense links inserted in the image caption (**w/o CL**), the whole serialized discourse features (**w/o DF**), the global dis- course features (**w/o GDF**) or the scene-specific discourse features (**w/o SDF**), from the LLM-generated constraints, and re-train the vision model to generate the visual narrative based on the textual narrative and ablated constraints. Our results show that removing either commonsense links or any subset of the discourse features leads to performance degra- dation on all metrics, indicating that both commonsense and discourse constraints provide complementary benefits for visual narrative generation. However, we detect greater degradation of w/o DF compared to w/o CL on most met-

**Model Setting FID CLIP-I CLIP-T CLIP-T Alignment Consistency**

|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  | | | | | **-MRR** | **Ent.** | **Num.** | **Attr.** | **Time** | **Loc.** |  | **Sty.** | **Char.** | **Loc.** |
|  | **No Constraint** | 64.7 | 0.628 | 0.198 | 0.102 | 0.471 | 0.288 | 0.167 | 0.405 | 0.380 |  | 0.500 | 0.146 | 0.290 |
| **ARLDM** | **LLM Constraints** | 56.7 | 0.652 | 0.200 | 0.143 | **0.569** | 0.307 | 0.222 | 0.441 | 0.442 |  | 0.656 | 0.262 | 0.330 |
|  | **Gold Constraints** | 56.5 | 0.689 | 0.202 | 0.149 | 0.577 | 0.357 | 0.268 | 0.489 | 0.486 |  | 0.688 | 0.289 | 0.384 |
|  | **No Constraint** | 63.6 | 0.646 | 0.195 | 0.101 | 0.454 | 0.283 | 0.165 | 0.397 | 0.374 |  | 0.425 | 0.104 | 0.227 |
| **StoryGen** | **LLM Constraints** | **56.2** | **0.660** | **0.201** | **0.144** | 0.563 | 0.307 | 0.208 | 0.423 | 0.397 |  | 0.607 | 0.289 | 0.319 |
|  | **Gold Constraints** | 55.6 | 0.692 | 0.202 | 0.147 | 0.571 | 0.352 | 0.258 | 0.469 | 0.439 |  | 0.647 | 0.291 | 0.375 |
|  | **No Constraint** | 74.9 | 0.637 | 0.183 | 0.058 | 0.448 | 0.292 | 0.184 | 0.423 | 0.374 |  | 0.945 | 0.335 | 0.702 |
| **MM-Inter.** | **LLM Constraints** | 72.9 | 0.655 | 0.188 | 0.107 | 0.535 | **0.366** | **0.265** | **0.473** | **0.459** |  | **0.956** | **0.355** | **0.780** |
|  | **Gold Constraints** | 72.0 | 0.678 | 0.190 | 0.112 | 0.545 | 0.413 | 0.313 | 0.503 | 0.561 |  | 0.969 | 0.383 | 0.803 |
| **Gold Ref.** | - | - | - | 0.207 | 0.160 | 0.758 | 0.817 | 0.778 | 0.755 | 0.752 |  | 0.969 | 0.769 | 0.814 |

Table 5. Evaluation results on **StorySalon** narratives. Notations are same as Table [2](#_bookmark20).

rics, revealing that discourse constraints may be more ben- eficial for improving visual narratives, especially w.r.t. gen- erating the location and non-character contents where sig- nificant gaps between w/o CL and w/o DF are found.

One concern of augmenting the vision model with nar- rative constraints is whether the improvements are just due to adding more input text tokens. To eliminate this con- cern, we include another ablation study (**Random**), where we group the training narrative samples by their length (*i.e*., number of scenes or images), randomly shuffle the constraints of narrative samples in the same group, and use the shuffled samples to re-train the vision model. Re- sults of **Random** are worse than the **No Constraint** setting, showing that generated visual narratives only benefit from aligned narrative constraints, and not random ones.

**Correlation between Visual Generation and Constraints** We further analyze how the alignment of narrative con- straints and textual narrative affects the faithfulness of vi- sual narrative generation. For each scene in the VWP test- ing samples, we calculate the CLIP text embedding simi- larity between the scene’s textual narrative and serialized narrative constraints, and pair it with the CLIP text-image embedding similarity between the scene’s textual narrative and visual narrative image generated by MM-Interleaved.[8](#_bookmark30) Our paired similarity scores achieve ∼0.4 Pearson correla- tion coefficient on both Gold and LLM settings,[9](#_bookmark31) indicating a clear positive correlation between (a) the alignment of a textual narrative and its constraints, and (b) the alignment between the same textual narrative and its visual manifesta- tion. This finding highlights the significance of planning in- termediate constraints to promote faithful visual narratives.

8The serialized narrative constraints are either from gold labels (in which case the corresponding CLIP text-image similarity is computed us- ing images generated with Gold Constraints) or LLM-generated (in which case the corresponding CLIP text-image similarity is computed using im- ages generated with LLM Constraints)

9We include the visualization of the paired similarity score distribution in the supplementary material.

### StorySalon Narratives

Table [5](#_bookmark29) presents the evaluation results of our deployed baseline methods on VinaBench’s StorySalon narratives. We draw the same conclusion as on VWP and Story- board20K narratives that incorporating narrative constraints effectively improves the faithfulness and self-consistency of visual narrative generation. The coherent results on all types of VinaBench narratives imply the ubiquity of implicit commonsense and discourse constraints in visual narratives, which also indicate that our proposed knowledge augmen- tation framework is universally effective on various visual narrative domains and image styles.

## Conclusion

In this work, we propose a new benchmark VinaBench that draws attention to the faithfulness and self-consistency challenges of visual narrative generation. VinaBench pro- vides a reliable foundation for generative vision models to learn faithful visual narratives with discourse and common- sense constraints. In view of the shortcomings of visual nar- rative evaluation, VinaBench also proposes new metrics to more closely assess the consistency of visual narrative gen- erations and their alignment with the input textual narrative. Our results indicate that model-generated visual narratives have considerable room for improvement to reach the level of human visual storytelling, which calls for future study on more robust visual narrative generators.

## Acknowledgements

We gratefully acknowledge the support of the Swiss Na- tional Science Foundation (No. 215390), Innosuisse (PFFS- 21-29), the EPFL Center for Imaging, Sony Group Corpo- ration, and a Meta LLM Evaluation Research Grant.

## References

1. Stanislaw Antol, Aishwarya Agrawal, Jiasen Lu, Margaret Mitchell, Dhruv Batra, C Lawrence Zitnick, and Devi Parikh. Vqa: Visual question answering. In *Proceedings of the IEEE international conference on computer vision*, pages 2425– 2433, 2015. [3](#_bookmark7)
2. Hong Chen, Rujun Han, Te-Lin Wu, Hideki Nakayama, and Nanyun Peng. Character-centric story visualization via visual planning and token alignment. *arXiv preprint* *arXiv:2210.08465*, 2022. [2](#_bookmark4)
3. Ethan Chern, Jiadi Su, Yan Ma, and Pengfei Liu. Anole: An open, autoregressive, native large multimodal mod- els for interleaved image-text generation. *arXiv preprint* *arXiv:2407.06135*, 2024. [4](#_bookmark11)
4. Neil Cohn. Visual narrative structure. *Cognitive science*, 37 (3):413–452, 2013. [2](#_bookmark4), [3](#_bookmark7), [4](#_bookmark11)
5. Neil Cohn and Patrick Bender. Drawing the line between constituent structure and coherence relations in visual narra- tives. *Journal of Experimental Psychology: Learning, Mem-* *ory, and Cognition*, 43(2):289, 2017. [2](#_bookmark4), [3](#_bookmark7), [4](#_bookmark11)
6. Abhishek Das, Satwik Kottur, Khushi Gupta, Avi Singh, Deshraj Yadav, Jose´ MF Moura, Devi Parikh, and Dhruv Ba- tra. Visual dialog. In *Proceedings of the IEEE conference on computer vision and pattern recognition*, pages 326–335, 2017. [3](#_bookmark7)
7. David K Dickinson, Julie A Griffith, Roberta Michnick Golinkoff, and Kathy Hirsh-Pasek. How reading books fos- ters language development around the world. *Child develop-* *ment research*, 2012(1):602807, 2012. [2](#_bookmark4)
8. Abhimanyu Dubey, Abhinav Jauhri, Abhinav Pandey, Ab- hishek Kadian, Ahmad Al-Dahle, Aiesha Letman, Akhil Mathur, Alan Schelten, Amy Yang, Angela Fan, et al. The llama 3 herd of models. *arXiv preprint arXiv:2407.21783*, 2024. [3](#_bookmark7), [6](#_bookmark16), [2](#_bookmark4)
9. Martin Heusel, Hubert Ramsauer, Thomas Unterthiner, Bernhard Nessler, and Sepp Hochreiter. Gans trained by a two time-scale update rule converge to a local nash equilib- rium. *Advances in neural information processing systems*, 30, 2017. [2](#_bookmark4), [5](#_bookmark14), [6](#_bookmark16)
10. Xudong Hong, Asad Sayeed, Khushboo Mehra, Vera Dem- berg, and Bernt Schiele. Visual writing prompts: Character- grounded story generation with curated image sequences. *Transactions of the Association for Computational Linguis-* *tics*, 11:565–581, 2023. [2](#_bookmark4), [3](#_bookmark7), [1](#_bookmark0)
11. Edward J Hu, Yelong Shen, Phillip Wallis, Zeyuan Allen- Zhu, Yuanzhi Li, Shean Wang, Lu Wang, and Weizhu Chen. Lora: Low-rank adaptation of large language models. *arXiv* *preprint arXiv:2106.09685*, 2021. [6](#_bookmark16)
12. Qingqiu Huang, Yu Xiong, Anyi Rao, Jiaze Wang, and Dahua Lin. Movienet: A holistic dataset for movie under- standing. In *Computer Vision–ECCV 2020: 16th European Conference, Glasgow, UK, August 23–28, 2020, Proceed-* *ings, Part IV 16*, pages 709–727. Springer, 2020. [1](#_bookmark0)
13. Ting-Hao Huang, Francis Ferraro, Nasrin Mostafazadeh, Is- han Misra, Aishwarya Agrawal, Jacob Devlin, Ross Gir- shick, Xiaodong He, Pushmeet Kohli, Dhruv Batra, et al. Visual storytelling. In *Proceedings of the 2016 conference*

*of the North American chapter of the association for com- putational linguistics: Human language technologies*, pages 1233–1239, 2016. [2](#_bookmark4), [3](#_bookmark7)

1. Ziqi Huang, Yinan He, Jiashuo Yu, Fan Zhang, Chenyang Si, Yuming Jiang, Yuanhan Zhang, Tianxing Wu, Qingyang Jin, Nattapol Chanpaisit, et al. Vbench: Comprehensive bench- mark suite for video generative models. In *Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern* *Recognition*, pages 21807–21818, 2024. [3](#_bookmark7), [4](#_bookmark11)
2. Dongfu Jiang, Xuan He, Huaye Zeng, Cong Wei, Max Ku, Qian Liu, and Wenhu Chen. Mantis: Interleaved multi-image instruction tuning. *arXiv preprint arXiv:2405.01483*, 2024. [3](#_bookmark7)
3. Justin Johnson, Andrej Karpathy, and Li Fei-Fei. Densecap: Fully convolutional localization networks for dense caption- ing. In *Proceedings of the IEEE conference on computer* *vision and pattern recognition*, pages 4565–4574, 2016. [3](#_bookmark7)
4. Robert B Lees. Syntactic structures, 1957. [3](#_bookmark7)
5. Bowen Li and Thomas Lukasiewicz. Learning to model mul- timodal semantic alignment for story visualization. *arXiv* *preprint arXiv:2211.07289*, 2022. [2](#_bookmark4)
6. Bo Li, Yuanhan Zhang, Dong Guo, Renrui Zhang, Feng Li, Hao Zhang, Kaichen Zhang, Yanwei Li, Ziwei Liu, and Chunyuan Li. Llava-onevision: Easy visual task transfer. *arXiv preprint arXiv:2408.03326*, 2024. [4](#_bookmark11), [5](#_bookmark14), [6](#_bookmark16)
7. Juncheng Li, Xin He, Longhui Wei, Long Qian, Linchao Zhu, Lingxi Xie, Yueting Zhuang, Qi Tian, and Siliang Tang. Fine-grained semantically aligned vision-language pre-training. *Advances in neural information processing sys-* *tems*, 35:7290–7303, 2022. [3](#_bookmark7)
8. Junnan Li, Dongxu Li, Caiming Xiong, and Steven Hoi. Blip: Bootstrapping language-image pre-training for unified vision-language understanding and generation. In *Interna- tional conference on machine learning*, pages 12888–12900.

PMLR, 2022. [2](#_bookmark4)

1. Yitong Li, Zhe Gan, Yelong Shen, Jingjing Liu, Yu Cheng, Yuexin Wu, Lawrence Carin, David Carlson, and Jianfeng Gao. Storygan: A sequential conditional gan for story vi- sualization. In *Proceedings of the IEEE/CVF conference on computer vision and pattern recognition*, pages 6329–6338, 2019. [2](#_bookmark4)
2. Mingxiang Liao, Hannan Lu, Xinyu Zhang, Fang Wan, Tianyu Wang, Yuzhong Zhao, Wangmeng Zuo, Qixiang Ye, and Jingdong Wang. Evaluation of text-to-video gen- eration models: A dynamics perspective. *arXiv preprint* *arXiv:2407.01094*, 2024. [3](#_bookmark7)
3. Zhiqiu Lin, Deepak Pathak, Baiqi Li, Jiayao Li, Xide Xia, Graham Neubig, Pengchuan Zhang, and Deva Ramanan. Evaluating text-to-visual generation with image-to-text gen- eration. *arXiv preprint arXiv:2404.01291*, 2024. [5](#_bookmark14), [6](#_bookmark16)
4. Chang Liu, Haoning Wu, Yujie Zhong, Xiaoyun Zhang, Yan- feng Wang, and Weidi Xie. Intelligent grimm-open-ended visual storytelling via latent diffusion models. In *Proceed- ings of the IEEE/CVF Conference on Computer Vision and* *Pattern Recognition*, pages 6190–6200, 2024. [2](#_bookmark4), [3](#_bookmark7), [5](#_bookmark14), [6](#_bookmark16), [7](#_bookmark21), [1](#_bookmark0)
5. Dongyang Liu, Shitian Zhao, Le Zhuo, Weifeng Lin, Yu Qiao, Hongsheng Li, and Peng Gao. Lumina-mgpt:

Illuminate flexible photorealistic text-to-image generation with multimodal generative pretraining. *arXiv preprint* *arXiv:2408.02657*, 2024. [4](#_bookmark11)

1. Chuofan Ma, Yi Jiang, Jiannan Wu, Zehuan Yuan, and Xiao- juan Qi. Groma: Localized visual tokenization for grounding multimodal large language models. In *European Conference* *on Computer Vision*, pages 417–435. Springer, 2025. [3](#_bookmark7)
2. Joseph P Magliano and Jeffrey M Zacks. The impact of con- tinuity editing in narrative film on event segmentation. *Cog-* *nitive science*, 35(8):1489–1517, 2011. [3](#_bookmark7)
3. Joseph P Magliano, Jason Miller, and Rolf A Zwaan. Index- ing space and time in film understanding. *Applied Cognitive Psychology: The Official Journal of the Society for Applied* *Research in Memory and Cognition*, 15(5):533–545, 2001. [3](#_bookmark7)
4. Adyasha Maharana and Mohit Bansal. Integrating visuospa- tial, linguistic and commonsense structure into story visual- ization. *arXiv preprint arXiv:2110.10834*, 2021. [2](#_bookmark4), [3](#_bookmark7)
5. Adyasha Maharana, Darryl Hannan, and Mohit Bansal. Storydall-e: Adapting pretrained text-to-image transformers for story continuation. In *European Conference on Computer* *Vision*, pages 70–87. Springer, 2022. [2](#_bookmark4), [5](#_bookmark14)
6. Weizhi Nie, Jiesi Li, Ning Xu, An-An Liu, Xuanya Li, and Yongdong Zhang. Triangle-reward reinforcement learning: a visual-linguistic semantic alignment for image captioning. In *Proceedings of the 29th ACM international conference on* *multimedia*, pages 4510–4518, 2021. [3](#_bookmark7)
7. Xichen Pan, Pengda Qin, Yuhong Li, Hui Xue, and Wenhu Chen. Synthesizing coherent story with auto-regressive la- tent diffusion models. In *Proceedings of the IEEE/CVF Win- ter Conference on Applications of Computer Vision*, pages 2920–2930, 2024. [2](#_bookmark4), [5](#_bookmark14), [6](#_bookmark16)
8. Zhiliang Peng, Wenhui Wang, Li Dong, Yaru Hao, Shaohan Huang, Shuming Ma, and Furu Wei. Kosmos-2: Ground- ing multimodal large language models to the world. *arXiv* *preprint arXiv:2306.14824*, 2023. [3](#_bookmark7)
9. Alec Radford, Jong Wook Kim, Chris Hallacy, Aditya Ramesh, Gabriel Goh, Sandhini Agarwal, Girish Sastry, Amanda Askell, Pamela Mishkin, Jack Clark, et al. Learning transferable visual models from natural language supervi- sion. In *International conference on machine learning*, pages 8748–8763. PMLR, 2021. [2](#_bookmark4), [3](#_bookmark7), [5](#_bookmark14), [6](#_bookmark16)
10. Aditya Ramesh, Mikhail Pavlov, Gabriel Goh, Scott Gray, Chelsea Voss, Alec Radford, Mark Chen, and Ilya Sutskever. Zero-shot text-to-image generation. In *International confer-* *ence on machine learning*, pages 8821–8831. Pmlr, 2021. [2](#_bookmark4)
11. Aditya Ramesh, Prafulla Dhariwal, Alex Nichol, Casey Chu, and Mark Chen. Hierarchical text-conditional image gen- eration with clip latents. *arXiv preprint arXiv:2204.06125*, 2022. [2](#_bookmark4)
12. Anna Rohrbach, Atousa Torabi, Marcus Rohrbach, Niket Tandon, Christopher Pal, Hugo Larochelle, Aaron Courville, and Bernt Schiele. Movie description. *International Journal* *of Computer Vision*, 123:94–120, 2017. [1](#_bookmark0)
13. Robin Rombach, Andreas Blattmann, Dominik Lorenz, Patrick Esser, and Bjo¨rn Ommer. High-resolution image synthesis with latent diffusion models. In *Proceedings of the IEEE/CVF conference on computer vision and pattern recognition*, pages 10684–10695, 2022. [2](#_bookmark4)
14. Chitwan Saharia, William Chan, Saurabh Saxena, Lala Li, Jay Whang, Emily L Denton, Kamyar Ghasemipour, Raphael Gontijo Lopes, Burcu Karagol Ayan, Tim Salimans, et al. Photorealistic text-to-image diffusion models with deep language understanding. *Advances in neural information* *processing systems*, 35:36479–36494, 2022. [2](#_bookmark4)
15. Robyn Speer, Joshua Chin, and Catherine Havasi. Concept- net 5.5: An open multilingual graph of general knowledge. In *Proceedings of the AAAI Conference on Artificial Intelli-* *gence*, 2017. [2](#_bookmark4)
16. Gabrielle A Strouse, Angela Nyhout, and Patricia A Ganea. The role of book features in young children’s transfer of in- formation from picture books to real-world contexts. *Fron-* *tiers in psychology*, 9:50, 2018. [2](#_bookmark4)
17. Changyao Tian, Xizhou Zhu, Yuwen Xiong, Weiyun Wang, Zhe Chen, Wenhai Wang, Yuntao Chen, Lewei Lu, Tong Lu, Jie Zhou, et al. Mm-interleaved: Interleaved image-text generative modeling via multi-modal feature synchronizer. *arXiv preprint arXiv:2401.10208*, 2024. [2](#_bookmark4), [6](#_bookmark16), [3](#_bookmark7)
18. Ruize Wang, Zhongyu Wei, Piji Li, Qi Zhang, and Xuan- jing Huang. Storytelling from an image stream using scene graphs. In *Proceedings of the AAAI Conference on Artificial* *Intelligence*, pages 9185–9192, 2020. [3](#_bookmark7)
19. Jinheng Xie, Jiajun Feng, Zhaoxu Tian, Kevin Qinghong Lin, Yawen Huang, Xi Xia, Nanxu Gong, Xu Zuo, Ji- aqi Yang, Yefeng Zheng, et al. Learning long-form video prior via generative pre-training. *arXiv preprint* *arXiv:2404.15909*, 2024. [2](#_bookmark4), [3](#_bookmark7), [1](#_bookmark0)
20. Peixi Xiong, Yilin Shen, and Hongxia Jin. Mga-vqa: multi- granularity alignment for visual question answering. *arXiv* *preprint arXiv:2201.10656*, 2022. [3](#_bookmark7)
21. Yuan Yao, Tianyu Yu, Ao Zhang, Chongyi Wang, Junbo Cui, Hongji Zhu, Tianchi Cai, Haoyu Li, Weilin Zhao, Zhihui He, et al. Minicpm-v: A gpt-4v level mllm on your phone. *arXiv* *preprint arXiv:2408.01800*, 2024. [3](#_bookmark7), [4](#_bookmark11), [6](#_bookmark16)
22. Jeffrey M Zacks, Nicole K Speer, and Jeremy R Reynolds. Segmentation in reading and film comprehension. *Journal* *of Experimental Psychology: General*, 138(2):307, 2009. [3](#_bookmark7)
23. Lianmin Zheng, Wei-Lin Chiang, Ying Sheng, Siyuan Zhuang, Zhanghao Wu, Yonghao Zhuang, Zi Lin, Zhuohan Li, Dacheng Li, Eric Xing, et al. Judging llm-as-a-judge with mt-bench and chatbot arena. *Advances in Neural Information* *Processing Systems*, 36:46595–46623, 2023. [3](#_bookmark7)
24. Sixiao Zheng and Yanwei Fu. Contextualstory: Consistent visual storytelling with spatially-enhanced and storyline con- text, 2024. [2](#_bookmark4), [5](#_bookmark14)
25. Deyao Zhu, Jun Chen, Xiaoqian Shen, Xiang Li, and Mo- hamed Elhoseiny. Minigpt-4: Enhancing vision-language understanding with advanced large language models. *arXiv* *preprint arXiv:2304.10592*, 2023. [3](#_bookmark7)
26. Xizhou Zhu, Weijie Su, Lewei Lu, Bin Li, Xiaogang Wang, and Jifeng Dai. Deformable detr: Deformable trans- formers for end-to-end object detection. *arXiv preprint arXiv:2010.04159*, 2020. [3](#_bookmark7)

# VinaBench: Benchmark for Faithful and Consistent Visual Narratives

Supplementary Material

The supplementary materials contain the following in-

formation and materials:

* + Data construction details (Section [S1](#_bookmark2)).
  + Evaluation details (Section [S2](#_bookmark6)).
  + Experimental setup details (Section [S3](#_bookmark9)).
  + Full experimental results (Section [S4](#_bookmark15))

## S1. VinaBench Data Construction Details

The visual-textual narrative pairs in our benchmark are sam- pled from three diverse visual storytelling datasets, includ- ing Visual Writing Prompts (VWP) [[10](#_bookmark41)], Storyboard20K

[[45](#_bookmark76)] and StorySalon [[25](#_bookmark56)]. The VWP dataset contains ∼12K

**Language # Scenes Language # Scenes**

|  |  |  |  |
| --- | --- | --- | --- |
| Hindi (hi) | 8213 | Hausa (ha) | 926 |
| French (fr) | 2503 | Spanish (es) | 758 |
| Indonesian (id) | 2197 | Italian (it) | 386 |
| Arabic (ar) | 2053 | Dutch (nl) | 198 |
| Marathi (mr) | 1544 | German (de) | 187 |
| Nepali (ne) | 1521 | Portuguese (pt) | 137 |
| Afrikaans (af) | 1464 | Finnish (fi) | 113 |
| Swahili (sw) | 1311 | Welsh (cy) | 82 |
| Vietnamese (vi) | 1220 | Polish (pl) | 78 |
| Uzbek (uz) | 1150 | **Total** | **26041** |

Table S1. Statistics of StorySalon scenes (or images) whose asso- ciated non-English narrative texts are translated into English.

narrative samples, whose visual narrative scenes are ex-

tracted and curated from MovieNet [[12](#_bookmark43)] frames, with cor- responding textual narratives crafted by Amazon Mechani- cal Turk (AMT) workers. The Storyboard20K dataset cov- ers a broader set of visual narrative scenes sampled from MovieNet and also LSMDC [[38](#_bookmark69)], with real movie synopses collected by a two-stage approach of automatic tagging and manual calibration. We filter the narrative samples in Sto- ryboard20K to keep ∼10K of them, which have aligned shot-by-shot movie synopses, serving as the textual narra- tives. Different from the movie-based narratives in VWP and Storyboard20K, the StorySalon dataset is oriented to animation-style visual narratives, whose images and aligned narrative texts are extracted from diverse YouTube videos and E-books. We use the Google Translation API[10](#_bookmark86) to trans- late non-English narrative texts collected in StorySalon into English. To ensure accurate translation, we only apply the API to ∼26K StorySalon scenes (or images) whose associ- ated narrative texts are in the 19 common languages shown in Table [S1](#_bookmark84), and then exclude the narrative samples whose texts are not fully translated into English. Besides, we filter the StorySalon samples whose textual narratives are poor- annotated, *i.e*., *>*10% of the sample’s scenes are annotated with uninformative texts containing less than 5 words. Fi- nally, ∼2K narrative samples from StorySalon are included. Based on the sampled visual-textual narrative pairs, Vin- aBench further annotates the commonsense and discourse constraints underlying each narrative sample, by prompting advanced VLMs and LLMs instead of relying on human annotators. Table [S2](#_bookmark85) summarizes the number of few-shot prompting examples used for each step of our VinaBench constraint annotation. For each annotation step, we tune the number of few-shot examples on a scale of 1 to 3, and se- lect the number that leads to the best annotation results in our pilot study on 10 narrative samples. Figure [S3](#_bookmark95) - [S6](#_bookmark96) list

10<https://github.com/ssut/py-googletrans>

**Cap. Ent. CL Sty. List Attr. Num. Name Time Loc.**

2 3 3 1 2 3 3 2 3 2

Table S2. Number of few-shot examples used for VinaBench data annotation, including dense image captioning (**Cap.**), visual en- tity extraction from dense captions (**Ent.**), commonsense link con- struction (**CL**), and the parsing of image appearance style (**Sty.**), global character list (**List**) and attributes (**Attr.**), and each scene’s presented character number (**Num.**) and name (**Name**), time of day (**Time**) and location (**Loc.**).

**Source Set # Nar. # Sce.**  **Avg. # Char. # CL # Label Types**

**per Nar. per Sce. Sty. Time Loc.**

|  |  |
| --- | --- |
| 9 | 6 545  191 |
| 9 | 6 551  341 |
| 9 | 6 518  111 |

train 11652 66632 3.07 1.71 274861

**VWP**

test 834 4901 3.00 1.73 22434

|  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- |
| **Story-** | train | 9252 | 92520 | 3.73 | 1.40 | 316356 |
| **board20K** | test | 1194 | 11940 | 4.07 | 1.59 | 40576 |
| **Story-** | train | 1593 | 21827 | 6.49 | 2.14 | 71489 |
| **Salon** | test | 85 | 1181 | 6.64 | 2.03 | 4374 |

Table S3. Statistics of VinaBench data samples and annotations, including total number of narratives (**# Nar.**), total number of scenes or images (**# Sce.**), average number of distinct characters per narrative (**Avg. # Char. per Nar.**), average number of pre- sented characters per scene (**Avg. # Char. per Sce.**), total number of commonsense links (**# CL**), total types of appearance style (**# Sty.**), time of day (**# Time**) and location (**# Loc.**) labels.

the specific few-shot examples and instructions that we fi- nally used for annotating the image captions, commonsense links, global and scene features in VinaBench, respectively. According to VinaBench annotations, we also exclude the narrative samples that contain no character or common- sense link. Table [S3](#_bookmark87) shows the final statistics of VinaBench narrative samples and annotations. Each VinaBench nar- rative sample contains ∼8.09 scenes (or images) in aver-

age, which is longer than prior image sequences (with a

length of 5) studied in visual narrative generation, *i.e*., VIST

**Aspect Metric Demonstration**

{*generated image for a scene*}

Does this image contain or imply {*each non-character visual entity in the scene’s gold commonsense links*}? Only answer yes or no.

**Non-Character**

{*generated image for a scene*}

How many characters are in this image? Only answer an Arabic number.

**Character Number**

{*generated image for a scene*}

Character descriptions:

**Alignment**

**Character Attribute**

{*gold character 1 presented in the scene features*}: {*profile of character 1 in the global features*}

{*gold character 2 presented in the scene features*}: {*profile of character 2 in the global features*}

...

Do characters in this image fit into their descriptions? Only answer yes or no.

{*generated image for a scene*}

**Time of Day**

Is this image taken in (or at) the {*gold time of day labeled in the scene features*}? Only answer yes or no.

{*generated image for a scene*}

Is this image taken at a (or an) {*gold location labeled in the scene features*}? Only answer yes or no.

**Location**

{*generated image for scene 1*} {*generated image for scene 2*} ... {*generated image for scene N*}

Are all these images in the same style? Only answer yes or no.

**Style**

{*generated image for scene X*} {*generated image for scene Y*} ...

**Consistency**

**Character**

**Location**

Do all these images contain the same character {*each overlapped character across the scenes X, Y, ..., indicated by their scene features*}:

{*profile of the overlapped character in the global features*}? Only answer yes or no.

{*generated image for scene X*} {*generated image for scene Y*} ...

Are all these images taken at the same {*gold location label shared by the scenes X, Y, ..., indicated by their scene features*}? Only answer yes or no.

Table S4. VQA demonstrations used for the fine-grained alignment and consistency metrics in VinaBench. For Alignment of Character Number, we record the average probability of the VLMs (MiniCPM-V-2.6 or LLaVA-OneVision-72B) outputting the correct character number as its first decoded token (or if characters are more than 9, the same number of leading tokens as the correct number of digits). For other metrics, we report the average probability of the VLM outputting *Yes* as its first decoded token. The spans labeled by “*{}*” in the demonstrations are replaced by their corresponding texts or images.

[[13](#_bookmark44)], PororoSV [[22](#_bookmark53)] and FlintstonesSV [[30](#_bookmark61)]. Besides, Vin- aBench incorporates new annotations of fine-grained visual narrative constraints, which are not involved in previous vi- sual narrative studies.

## S2. VinaBench Evaluation Details

We adopt zero-shot prompting to implement all of our pro- posed VQA-based fine-grained alignment and consistency metrics in VinaBench. Table [S4](#_bookmark88) lists the specific demon- strations used for our VQA-based metrics. The VQA score of non-character alignment metric is averaged across each non-character visual entity labeled in gold commonsense links. While for other fine-grained alignment metrics, we calculate the average VQA score across each scene in the testing narrative samples. For the style consistency metric, since it is based on all scenes of a narrative, we average the VQA score across each testing narrative sample. In terms of the character and location consistency metrics, the VQA score is averaged across each gold character or location la- beled in the narrative that is shared by multiple scenes.

## S3. Experimental Setup Details

For the setting of training visual narrative models with LLM Constraints, we preprocess our annotated common- sense and discourse constraints in VinaBench, to enable training the auto-regressive LLM (Llama3.1-70B-Instruct [[8](#_bookmark39)]) to generate those constraints. First, we merge the com-

monsense links into the dense image caption. Specifically, for each entity in the image caption, if it appears in one of the commonsense links, we insert its linked textual narra- tive phrase right after the entity (in parentheses). For exam- ple, if the image caption is *A woman wearing a green shirt*, and its entity *woman* is linked to the character *Samantha* in the textual narrative, the caption will be converted to *A woman (Samantha) wearing a green shirt*. Second, we use a template to serialize the scene features, and insert pre- sented characters’ attributes in the global features. For in- stance, if the scene features indicate that the presented char- acter, time of day and location are *Samantha*, *afternoon* and *kitchen*, respectively, and *Samantha* has the profile *adult female, wife* in the global features, the scene features will be serialized into the text sequence: *[Characters] Saman- tha (adult female, wife) [Time of Day] afternoon [Location] kitchen*. We train the LLM to auto-regressively generate the concatenation of image caption (with commonsense links inserted) and serialized scene features, as the narrative con- straints used for augmenting the visual narrative generation.

We test three representative visual narrative generation models on VinaBench, which cover diverse model struc- tures, as described below:

* **ARLDM** [[33](#_bookmark64)] trains a Stable Diffusion [[39](#_bookmark70)] module to auto-regressively generate each visual narrative image, which is conditioned on the BLIP [[21](#_bookmark52)] embeddings of previous scenes’ generated images and input textual con- straints, and the CLIP [[35](#_bookmark66)] embedding of current scene’s

**Model Setting Ranking Non-Character Character Number Character Attribute Time of Day Location CLIP-T-MRR VQA-MRR MiniCPM Llava MiniCPM Llava MiniCPM Llava MiniCPM Llava MiniCPM Llava**

|  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  | No Constraint | 0.1096 | 0.1435 | 0.5640 | 0.5419 | 0.3980 | 0.3858 | 0.3199 | 0.3176 | 0.4429 | 0.3942 | 0.3759 | 0.4031 |
| **ARLDM** | LLM Constraints | **0.1508** | **0.2423** | **0.6741** | **0.6344** | 0.4434 | 0.4345 | 0.4107 | 0.3785 | **0.5119** | **0.4810** | 0.5835 | 0.5825 |
|  | Gold Constraints | 0.1551 | 0.2503 | 0.6823 | 0.6420 | 0.6188 | 0.5607 | 0.5464 | 0.5573 | 0.5183 | 0.4945 | 0.6899 | 0.5650 |
|  | No Constraint | 0.1003 | 0.1158 | 0.4708 | 0.4707 | 0.3352 | 0.3236 | 0.2846 | 0.2167 | 0.2788 | 0.2804 | 0.3153 | 0.3791 |
| **StoryGen** | LLM Constraints | 0.1056 | 0.1503 | 0.5950 | 0.5764 | 0.4236 | 0.4028 | 0.3412 | 0.3191 | 0.3673 | 0.3444 | 0.5041 | 0.5460 |
|  | Gold Constraints | 0.1151 | 0.1728 | 0.6138 | 0.5873 | 0.5474 | 0.5081 | 0.4443 | 0.3749 | 0.3930 | 0.3467 | 0.5982 | 0.6325 |
|  | No Constraint | 0.0660 | 0.1126 | 0.4990 | 0.4856 | 0.4088 | 0.3982 | 0.3259 | 0.3265 | 0.4632 | 0.4373 | 0.4489 | 0.4713 |
|  | LLM Constraints | 0.1107 | 0.2074 | 0.6434 | 0.5942 | **0.4578** | **0.4407** | **0.4118** | **0.3915** | 0.4856 | 0.4745 | **0.5998** | **0.6016** |

**MM-Inter.**

|  |  |  |  |  |  |  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| - w/o CL 0.1090 | | 0.2037 | 0.6422 | 0.5934 | 0.4546 | 0.4344 | 0.4092 | 0.3870 | 0.4748 | 0.4681 | 0.5968 | 0.5944 |
| - w/o DS | 0.1074 | 0.1983 | 0.6238 | 0.5872 | 0.4489 | 0.4355 | 0.4005 | 0.3887 | 0.4742 | 0.4635 | 0.5642 | 0.5734 |
| - Random | 0.0476 | 0.0861 | 0.4149 | 0.4152 | 0.3986 | 0.3904 | 0.3180 | 0.3135 | 0.4120 | 0.3849 | 0.4116 | 0.4335 |

|  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  | Gold Constraints | 0.1179 | 0.2105 | 0.6521 | 0.6054 | 0.6226 | 0.5634 | 0.5462 | 0.5736 | 0.4965 | 0.4841 | 0.7276 | 0.7157 |
| **Gold Ref.** | - | 0.1586 | 0.2662 | 0.7755 | 0.7163 | 0.8127 | 0.7652 | 0.7581 | 0.7157 | 0.7555 | 0.7196 | 0.8632 | 0.8100 |

Table S5. Full evaluation results of our ranking-based and fine-grained **Alignment** metrics on VWP narratives. *MiniCPM* and *Llava*

denote our fine-grained VQA-based metrics deployed on MiniCPM-V-2.6 and LLaVA-OneVision-72B. *Gold Ref.* denotes gold references.

Best results with *LLM Constraints* and with *Gold Constraints* are **bolded** and underlined, respectively.

**Model Setting Style Character Location**

**MiniCPM Llava MiniCPM Llava MiniCPM Llava**

|  |  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- |
|  | No Constraint | 0.4664 | 0.5857 | 0.3793 | 0.4102 | 0.3759 | 0.1788 |
| **ARLDM** | LLM Constraints | 0.8586 | 0.7434 | 0.5507 | 0.5215 | 0.6888 | 0.3472 |
|  | Gold Constraints | 0.8539 | 0.7326 | 0.5687 | 0.5280 | 0.6972 | 0.4359 |
|  | No Constraint | 0.2379 | 0.4936 | 0.2305 | 0.3809 | 0.3106 | 0.2020 |
| **StoryGen** | LLM Constraints | 0.4523 | 0.5390 | 0.4177 | 0.5014 | 0.4649 | 0.3192 |
|  | Gold Constraints | 0.4747 | 0.5421 | 0.4233 | 0.5105 | 0.5272 | 0.3800 |
|  | No Constraint | 0.9470 | 0.8077 | 0.5823 | 0.5631 | 0.4489 | 0.4831 |
|  | LLM Constraints | **0.9859** | **0.8672** | **0.6780** | **0.6375** | **0.7642** | **0.6151** |
| **MM-Inter.** | * w/o CL * w/o DS | 0.9829  0.9776 | 0.8664  0.8604 | 0.6431  0.6443 | 0.6290  0.6095 | 0.7577  0.6842 | 0.6113  0.5937 |
|  | - Random | 0.9453 | 0.7933 | 0.5763 | 0.5768 | 0.4471 | 0.4769 |
|  | Gold Constraints | 0.9764 | 0.8542 | 0.6880 | 0.6399 | 0.8558 | 0.6931 |
| **Gold Ref.** | - | 0.9706 | 0.8790 | 0.7797 | 0.7077 | 0.8632 | 0.7754 |

Table S6. Full evaluation results of our **Consistency** metrics on VWP narratives. Notations are same as Table [S5](#_bookmark89).

|  |  |  |  |  |
| --- | --- | --- | --- | --- |
| **Model** | **Setting** | **FID** | **CLIP-I** | **CLIP-T** |
|  | No Constraint | 42.55 | 0.6384 | 0.1951 |
| **ARLDM** | LLM Constraints | **37.60** | **0.6762** | **0.2036** |
|  | Gold Constraints | 35.25 | 0.7156 | 0.2089 |
|  | No Constraint | 78.58 | 0.5624 | 0.1836 |
| **StoryGen** | LLM Constraints | 52.09 | 0.6003 | 0.1935 |
|  | Gold Constraints | 48.93 | 0.6194 | 0.1901 |
|  | No Constraint | 48.33 | 0.6337 | 0.1758 |
|  | LLM Constraints | 42.24 | 0.6670 | 0.1978 |

- w/o DS

|  |  |  |  |
| --- | --- | --- | --- |
| **MM-Inter.** - w/o CL | 42.85  43.28 | 0.6660  0.6568 | 0.1966  0.1960 |
| - Random | 53.74 | 0.6143 | 0.1739 |
| Gold Constraints | 39.27 | 0.6981 | 0.1997 |
| **Gold Ref.** - - - 0.2077 | | | |

Table S7. Evaluation results of full-reference metrics on VWP narratives. Lower FID is better. Notations are same as Table [S5](#_bookmark89).

input textual constraints.

* **StoryGen** [[25](#_bookmark56)] uses a dual-diffusion structure to perform the auto-regressive generation of narrative images. It first adds noise to each previously generated image, and then the noisy image is de-noised by a Stable Diffusion mod- ule (conditioned on the image’s corresponding input tex-

tual constraints), whose latent diffusion states are used as the extracted features of the image. Conditioned on the current textual constraints and the concatenation of previ- ous images’ extracted features, a second Stable Diffusion module is trained to generate the current narrative image.

* **MM-Interleaved (MM-Inter.)** [[43](#_bookmark74)] trains a VLM, *i.e*., Vicuna [[49](#_bookmark80)] with CLIP vision encoder, to model the in- terleaved sequence of previously generated images and their textual constraints, and a Stable Diffusion module to generate the current narrative image based on the output states of the VLM. Both the VLM and the diffusion mod- ule are augmented by additional layers of cross-attention to sparse image features via Deformable Attention [[52](#_bookmark83)].

## S4. Full Experimental Results

Table [S5](#_bookmark89) - [S13](#_bookmark92) present the full evaluation results of vi- sual narrative generation on VinaBench. All results coher- ently indicate the same conclusion that learning with Vin- aBench’s commonsense and discourse constraints signifi- cantly improves the consistency of visual narrative gener- ations and their alignment to the input textual narrative. Moreover, our two ranking-based metrics CLIP-T-MRR and VQA-MRR consistently show that all model gener- ations and the gold reference score far below the maxi- mum (1.0), supporting the fact that creating visual narra- tives is a considerably open-ended task, which does not pos- sess the only feasible reference that always ranks the first. More importantly, our VQA-based metrics deployed on MiniCPM-V-2.6 and LLaVA-OneVision-72B demonstrate mostly aligned preference among different models and set- tings. This verifies that our proposed metrics are not biased on the preference of a specific VLM used for generating the VQA scores.

Besides of MM-Interleaved, which is the best-performed model fine-tuned on VinaBench, we further test other sim-

**Model Setting Ranking Non-Character Character Number Character Attribute Time of Day Location CLIP-T-MRR VQA-MRR MiniCPM Llava MiniCPM Llava MiniCPM Llava MiniCPM Llava MiniCPM Llava**

|  |  |  |  |  |  |  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| No Constraint | 0.0954 | 0.1279 | 0.3487 | 0.3302 | 0.2682 | 0.2714 | 0.2330 | 0.2208 | 0.3250 | 0.2768 | 0.2987 | 0.3341 |
| **ARLDM** LLM Constraints | **0.1369** | **0.2273** | **0.6590** | **0.6233** | 0.4702 | **0.4330** | 0.3694 | 0.3434 | **0.4049** | 0.3623 | 0.4899 | 0.5031 |
| Gold Constraints | 0.1415 | 0.2350 | 0.6745 | 0.6319 | 0.6067 | 0.5743 | 0.4804 | 0.4485 | 0.4689 | 0.4084 | 0.5994 | 0.6011 |
| No Constraint | 0.0926 | 0.1079 | 0.3051 | 0.3080 | 0.2908 | 0.2956 | 0.2064 | 0.1593 | 0.1599 | 0.1988 | 0.1710 | 0.2505 |
| **StoryGen** LLM Constraints | 0.0992 | 0.1438 | 0.5259 | 0.5306 | 0.4304 | 0.3955 | 0.2684 | 0.2677 | 0.2754 | 0.2580 | 0.3739 | 0.4423 |
| Gold Constraints | 0.1078 | 0.1653 | 0.5273 | 0.5291 | 0.6629 | 0.5572 | 0.3709 | 0.3636 | 0.2950 | 0.2686 | 0.4281 | 0.4883 |
| No Constraint | 0.0521 | 0.0979 | 0.3286 | 0.3264 | 0.2616 | 0.2323 | 0.2290 | 0.1956 | 0.3311 | 0.3042 | 0.2294 | 0.2588 |
| **MM-Inter.** LLM Constraints | 0.0983 | 0.1935 | 0.6030 | 0.5702 | **0.4767** | 0.4329 | **0.3796** | **0.3449** | 0.3733 | **0.3686** | **0.4971** | **0.5170** |
| Gold Constraints | 0.1049 | 0.1959 | 0.6375 | 0.5786 | 0.6132 | 0.5746 | 0.4877 | 0.4456 | 0.4231 | 0.4155 | 0.6167 | 0.6224 |
| **Gold Ref.** - | 0.1657 | 0.2735 | 0.7630 | 0.7118 | 0.8682 | 0.8375 | 0.7981 | 0.7156 | 0.7620 | 0.7114 | 0.8955 | 0.7879 |

Table S8. Full zero-shot evaluation results of our ranking-based and fine-grained **Alignment** metrics on Storyboard20K narratives.

Notations are same as Table [S5](#_bookmark89).

**Model Setting Style Character Location**

![](data:image/png;base64...)

![](data:image/png;base64...)![](data:image/png;base64...)

constraints

Gold

LLM-Generated

**Pearson correlation coefficient**

**0.3917**

**0.4085**

![](data:image/png;base64...)

Similarity Score Distribution

Similarity(Constraints, Textual Na ive)

|  |  |  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **MiniCPM**  0.2279 | **Llava**  0.2089 |  | **MiniCPM**  0.2459 | **Llava**  0.2373 |  | **MiniCPM**  0.0879 | **Llava**  0.1133 | 0.8 |
| 0.6477 | 0.6140 |  | 0.5113 | 0.4531 |  | 0.3047 | 0.2686 | rrat |

No Constraint

**ARLDM** LLM Constraints

|  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- |
| Gold Constraints | 0.6968 | 0.6167 | 0.5997 | 0.5031 | 0.4219 | 0.3679 |
| No Constraint | 0.2671 | 0.2613 | 0.0645 | 0.1033 | 0.2259 | 0.2108 |

**StoryGen**

LLM Constraints 0.5209 0.5795 0.3156 0.3494 0.3526 0.3395

Gold Constraints 0.5259 0.5848 0.3688 0.4108 0.4465 0.3975

0.6

0.4

0.2

0

−0.2

0.1 0.15 0.2 0.25 0.3

Similarity(Generated Visual Narrative, Textual Narrative)

No Constraint 0.8766 0.8594 0.3627 0.3667 0.4207 0.3374

**MM-Inter.** LLM Constraints **0.9324 0.9016 0.6187 0.5694 0.6958 0.6378**

Gold Constraints 0.9349 0.9047 0.6598 0.6283 0.7956 0.7310

**Gold Ref.** -

0.9399 0.8556 0.8118 0.7665 0.8955 0.7996

Table S9. Full zero-shot evaluation results of our

**Consistency** metrics on Storyboard20K narratives.

Notations are same as Table [S5](#_bookmark89).

|  |  |  |  |  |
| --- | --- | --- | --- | --- |
| **Model** | **Setting** | **FID** | **CLIP-I** | **CLIP-T** |
|  | No Constraint | 97.91 | 0.5910 | 0.1936 |
| **ARLDM** | LLM Constraints | **82.64** | **0.6395** | **0.1995** |
|  | Gold Constraints | 77.70 | 0.6754 | 0.2057 |
|  | No Constraint | 161.41 | 0.5367 | 0.1690 |
| **StoryGen** | LLM Constraints | 112.03 | 0.5832 | 0.1880 |
|  | Gold Constraints | 107.67 | 0.5966 | 0.1837 |
|  | No Constraint | 102.42 | 0.5876 | 0.1644 |
| **MM-Inter.** | LLM Constraints | 95.73 | 0.6362 | 0.1893 |
|  | Gold Constraints | 90.82 | 0.6587 | 0.1933 |
| **Gold Ref.** | - | - | - | 0.2049 |

Table S10. Evaluation results of full-reference met- rics on Storyboard20K narratives. Lower FID is better.

Notations are same as Table [S5](#_bookmark89).

ilar interleaved image-text generative models, including **Anole** [[3](#_bookmark34)] and **Lumina-mGPT** [[26](#_bookmark57)], which however com- pletely fail our benchmark task (with nearly zero scores on VinaBench metrics) under zero-shot or few-shot set- tings.[11](#_bookmark90) This indicates that supervised learning (or fine- tuning) is necessary for current interleaved image-text gen- erative models to address our benchmark’s challenging task, while the fine-tuning codes of these models are not publicly available, which hinders more experimental verifications.

11We verify that MM-Interleaved model would also fail our benchmark task under zero/few-shot settings, *i.e*., without fine-tuning.

Figure S1. Correlation between generated visual narrative images and augmented narrative constraints (either from gold labels or generated by LLM, Llama3.1-70B-Instruct), w.r.t. their CLIP em- bedding similarity to the input textual narrative. Data samples are from MM-Interleaved generations (with LLM Constraints and with Gold Constraints) on VWP narratives.

Figure [S1](#_bookmark91) shows the distribution of paired similarity scores in our correlation study between visual narrative gen- eration and constraints, where the x-axis denotes the CLIP similarity between each visual generation and input tex- tual narrative, and the y-axis denotes the CLIP similarity between the sample’s augmented constraints and the tex- tual narrative. The distribution demonstrates a clear posi- tive correlation between the narrative constraints and their resulting visual narrative generations, with ∼ 0*.*4 Pearson correlation coefficient, no matter whether the constraints are from gold labels or generated by LLM. This highlights the importance of planning faithful storytelling constraints to advance visual narrative generations.

We also evaluate MM-Interleaved model on varied set- tings of using LLMs to generate narrative constraints (with LLM Constraints), including 4-shot (**4S**) prompt- ing Llama3.1-70B-Instruct (**Llama-70B**), and fine-tuning (**FT**) Llama3.1-8B-Instruct (**Llama-8B**), **Gemma-7B** and **Qwen2-7B**, compared to our adopted setting of fine-tuning

**Model Setting Ranking Non-Character Character Number Character Attribute Time of Day Location CLIP-T-MRR VQA-MRR MiniCPM Llava MiniCPM Llava MiniCPM Llava MiniCPM Llava MiniCPM Llava**

|  |  |  |  |  |  |  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| No Constraint | 0.1015 | 0.1367 | 0.4706 | 0.6048 | 0.2878 | 0.2884 | 0.1666 | 0.1764 | 0.4045 | 0.4135 | 0.3802 | 0.4041 |
| **ARLDM** LLM Constraints | 0.1428 | 0.2328 | **0.5685** | **0.6432** | 0.3065 | 0.3118 | 0.2217 | 0.2787 | 0.4409 | 0.4345 | 0.4420 | 0.4468 |
| Gold Constraints | 0.1493 | 0.2417 | 0.5771 | 0.6519 | 0.3568 | 0.3386 | 0.2676 | 0.2984 | 0.4894 | 0.4474 | 0.4862 | 0.4839 |
| No Constraint | 0.1010 | 0.1347 | 0.4536 | 0.5257 | 0.2825 | 0.2851 | 0.1651 | 0.1738 | 0.3965 | 0.4043 | 0.3735 | 0.3961 |
| **StoryGen** LLM Constraints | **0.1443** | **0.2348** | 0.5633 | 0.6037 | 0.3070 | 0.3148 | 0.2079 | 0.2559 | 0.4225 | 0.4267 | 0.3971 | 0.4205 |
| Gold Constraints | 0.1469 | 0.2410 | 0.5714 | 0.6160 | 0.3515 | 0.3376 | 0.2577 | 0.2907 | 0.4690 | 0.4400 | 0.4385 | 0.4609 |
| No Constraint | 0.0581 | 0.1062 | 0.4477 | 0.4983 | 0.2917 | 0.2946 | 0.1840 | 0.2188 | 0.4227 | 0.4158 | 0.3743 | 0.3714 |
| **MM-Inter.** LLM Constraints | 0.1065 | 0.2015 | 0.5352 | 0.5853 | **0.3662** | **0.3847** | **0.2645** | **0.2903** | **0.4727** | **0.4481** | **0.4587** | **0.4536** |
| Gold Constraints | 0.1124 | 0.2032 | 0.5450 | 0.5986 | 0.4126 | 0.4242 | 0.3125 | 0.3238 | 0.5030 | 0.4624 | 0.5609 | 0.5375 |
| **Gold Ref.** - | 0.1601 | 0.2688 | 0.7584 | 0.7432 | 0.8171 | 0.8061 | 0.7780 | 0.7655 | 0.7545 | 0.7728 | 0.7523 | 0.7635 |

Table S11. Full evaluation results of our ranking-based and fine-grained **Alignment** metrics on StorySalon narratives.

Notations are same as Table [S5](#_bookmark89).

**Model Setting Style Character Location**

**MiniCPM Llava MiniCPM Llava MiniCPM Llava**

|  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- |
| No Constraint | 0.5000 | 0.4824 | 0.1461 | 0.1839 | 0.2903 | 0.2596 |
| **ARLDM** LLM Constraints | 0.6563 | 0.5684 | 0.2622 | 0.2551 | 0.3296 | 0.2978 |
| Gold Constraints | 0.6875 | 0.5770 | 0.2890 | 0.2672 | 0.3839 | 0.3257 |
| No Constraint | 0.4246 | 0.4197 | 0.1041 | 0.1362 | 0.2265 | 0.2205 |
| **StoryGen** LLM Constraints | 0.6073 | 0.5583 | 0.2886 | 0.2793 | 0.3191 | 0.2784 |
| Gold Constraints | 0.6472 | 0.5609 | 0.2911 | 0.2826 | 0.3745 | 0.3147 |
| No Constraint | 0.9450 | 0.8668 | 0.3349 | 0.4086 | 0.7022 | 0.6232 |
| **MM-Inter.** LLM Constraints | **0.9563** | **0.8747** | **0.3545** | **0.4449** | **0.7798** | **0.6978** |
| Gold Constraints | 0.9688 | 0.8786 | 0.3834 | 0.4737 | 0.8034 | 0.7617 |
| **Gold Ref.** - | 0.9688 | 0.9865 | 0.7686 | 0.7611 | 0.8135 | 0.8059 |

Table S12. Full evaluation results of our **Consistency** metrics on StorySalon narratives. Notations are same as Table [S5](#_bookmark89).

**Model Setting FID CLIP-I CLIP-T**

No Constraint 64.69 0.6278 0.1975

**LLM Constraints FID CLIP-I CLIP-T CLIP-T-MRR Alignment Consistency**

**ARLDM** LLM Constraints 56.65 0.6515 0.2001

Gold Constraints 56.51 0.6887 0.2022

**FT Llama-70B** 42.24 0.6670 0.1978 0.1107 0.5197 0.8093

**4S Llama-70B** 42.95 0.6625 0.1973 0.1104 0.4948 0.7936

**FT Llama-8B** 49.61 0.6293 0.1833 0.0570 0.3980 0.7436

**FT Gemma-7B** 51.69 0.6180 0.1788 0.0445 0.3751 0.7312

**FT Qwen2-7B** 47.83 0.6376 0.1915 0.0866 0.4507 0.7606

**Gold Ref.** - - 0.2077 0.1586 0.7930 0.8711

**MM-Inter.**

|  |  |  |  |  |
| --- | --- | --- | --- | --- |
| **StoryGen** | No Constraint LLM Constraints | 63.63  **56.18** | 0.6463  **0.6600** | 0.1946  **0.2005** |
|  | Gold Constraints | 55.62 | 0.6919 | 0.2021 |
|  | No Constraint | 74.92 | 0.6370 | 0.1834 |

LLM Constraints 72.91 0.6552 0.1879

Gold Constraints 72.03 0.6780 0.1896

**Gold Ref.** - - - 0.2065

Table S14. Performance of MM-Interleaved model with differ- ent LLM-generated narrative constraints, evaluated on VWP nar- ratives. Llama3.1-70B-Instruct (Llama-70B) is fine-tuned (FT)

Table S13. Evaluation results of full-reference met- rics on StorySalon narratives. Lower FID is better.

Notations are same as Table [S5](#_bookmark89).

Llama3.1-70B-Instruct with LoRA. Results in Table [S14](#_bookmark93), based on the VWP narratives of VinaBench, show that our adopted setting best augments visual narrative generation.

Figure [S2](#_bookmark94) displays several visual narratives generated by our deployed baseline methods. The model generations still contain unfaithful or inconsistent contents, even with the augmentation of narrative constraints. This reveals the chal- lenge of developing more robust methods for the visual nar- rative generation, which we leave for future work.

with LoRA or 4-shot (4S) prompted, while Llama3.1-8B-Instruct (Llama-8B), Gemma-7B and Qwen2-7B are fully fine-tuned. **Alignment** and **Consistency** denote the average score of our pro- posed fine-grained alignment and consistency metrics.

![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)

**ARLDM**

**(No Constraint)**

**ARLDM**

**(LLM Constraints)**

**MM-Inter. (No Constraint)**

**MM-Inter. (LLM Constraints)**

**Gold Ref.**

Nicolas is threatening the lab workers with a gun.

Nicolas stares intently at the beakers and flasks in the lab.

Nicolas turns away because he hears something behind him. He looks down.

Nicolas sees Keith is holding Nicolas shoots Keith, and a plastic gun pretending it is some beakers of chemicals real. Nicolas becomes upset. burst with smoke billows.

(a)

![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)

**ARLDM**

**(No Constraint)**

**ARLDM**

**(LLM Constraints)**

**MM-Inter. (No Constraint)**

**MM-Inter. (LLM Constraints)**

**Gold Ref.**

Edward and several other men gather around Tom, discussing the plan.

Tom uses a compass as he plots out the best way to proceed on a map.

Jeremy and Adam listen with Tom hardens his expression.

tight expressions, as Tom explains how to proceed.

He knows the way ahead will be rough but must be done.

The youngest soldier looks up at him and nods. He is ready to go.

(b)

Figure S2. Visual narratives generated by ARLDM and MM-Interleaved (MM-Inter.), with and without LLM-generated narrative con- straints, compared to the gold reference. In narrative (a), LLM-generated constraints significantly improve MM-Interleaved, by pushing its generation more aligned with the lab setting described in textual narrative. By contrast, ARLDM fails to generate images with decent alignment to textual narrative, although the image style consistency is improved by LLM constraints, *e.g*., avoid generating a black and white image at the fourth scene. In narrative (b), the generation of ARLDM with LLM constraints turns out to achieve improved image style consistency and alignment to textual narrative plot, *e.g*., showing a map in the second scene. Besides, compared to MM-Interleaved with- out constraint, the generation of MM-Interleaved with LLM constraints displays better consistency of character (*e.g*., Tom) facial features and background location, and comparable faithfulness to textual narrative. However, both model generations with constraints still contain unreasonable contents, *e.g*., a sudden shift of character Nicolas’s outfit in the generation of MM-Interleaved (with LLM Constraints) in (a), inconsistent faces of character Tom in the ARLDM (with LLM Constraints) generation in (b).

***Dense Image Captioning***

![](data:image/png;base64...)![](data:image/jpeg;base64...)![](data:image/png;base64...)![](data:image/jpeg;base64...)

System Prompt

You are given an image and a corresponding narrative that tells a story about the image. Please describe the image in detail in two or three sentences.

Image

Example Input

Narrative

Kate was cooking lunch at home on a weekend.

They chose a table to sit down, while Elle read Karen a piece of bad news on the newspaper.

Example Output

Caption

A woman in a green shirt is standing in a kitchen, washing dishes in a sink. The kitchen is well-equipped with a stove, oven, and various kitchen utensils.

There are multiple cups and bowls on the counter, and a vase can be seen on the counter as well.

Two women are sitting at a table in a restaurant. One woman is wearing a pink shirt, and the other is wearing a white shirt. The woman wearing a pink shirt is holding a newspaper and appears to be engaged in reading.

Figure S3. Few-shot prompting demonstrations for constructing the dense **image captions** in VinaBench.

***Visual Entity Extraction from Dense Captions Character***

![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)

System You are given a caption. Output a list of nouns or noun phrases that are people in the caption.

Prompt If there is no noun or noun phrase that belongs to people, report 'none'.

Example Input

Caption

A woman in a green shirt is standing in a kitchen, washing dishes in a sink. The kitchen is well-equipped with a stove, oven, and various kitchen utensils. There are multiple cups and bowls on the counter, and a vase can be seen on the counter as well.

A teacher is smiling to a group of students in front of a public phone. The teacher talks to the student's family.

The image is of a winter scene with barren trees, snow on the ground, and a few buildings in the background.

Example Output

Phrases

woman in a green shirt

teacher,

group of students, student's family

none

***Non-Character Noun***

![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)

System Prompt

You are given a caption. Output a list of nouns or noun phrases that are non-human objects in the caption. If there is no noun or noun phrase that belongs to non-human objects, report 'none'.

Example Input

Caption

A woman in a green shirt is standing in a kitchen, washing dishes in a sink. The kitchen is well-equipped with a stove, oven, and various kitchen utensils. There are multiple cups and bowls on the counter, and a vase can be seen on the counter as well.

A teacher is smiling to a group of students in front of a public phone. The teacher talks to the student's family.

Two men are quarreling with red faces.

Example Output

Phrases

green shirt, kitchen, dishes, sink, stove, oven, kitchen utensils, cups, bowls, counter, vase

public phone

none

***Non-Character Verb***

![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)

System You are given a caption. Output a list of verbs or verb phrases that are actions in the caption.

Prompt If there is no verb or verb phrase that belongs to actions, report 'none'.

Example Input

She is cooking lunch in the

Caption kitchen with the milk she

bought from the store.

He should wait before going

l

swimming, but instead he wil

It was a beautiful sunny day.

hike with his friends.

Example Output

Phrases

cooking, bought

wait,

going swimming, hike

none

(a)

***Commonsense Link Construction Character Entity***

![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)

System Prompt

You are given a caption, a narrative statement, and an entity in the caption. If there is a link between the caption entity and an entity in the narrative, output the link. If there is no link for a caption entity, report 'no link'. Do not give any explanation in your answer.

Caption

A woman with a sad face is sitting at the table, opposite her is another woman reading a newspaper.

The reddish orange sun is slightly visible at the horizon as it rises. The sky is mixed with pink and orange clouds. The ocean waves are crashing against the sand of the beach. Three people run towards the water, each holding a surfboard. A lifeguard sits near the edge of the water.

The reddish orange sun is slightly visible at the horizon as it rises. The sky is mixed with pink and orange clouds. The ocean waves are crashing against the sand of the beach. Three people run towards the water, each holding a surfboard. A lifeguard sits near the edge of the water.

Example

Input Narrative

They chose a table to sit down, while Elle read Karen a piece of bad news on the newspaper.

The three friends went to the beach at dawn to surf.

The three friends went to the beach at dawn to surf.

Caption Entity

woman with a sad face

people

lifeguard

Example Output

Link

woman with a sad face

− Karen

people − friends

no link

***Non-Character Entity***

![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)

System Prompt

You are given a caption, a narrative statement, and an entity in the caption. If there is a link between the caption entity and an entity in the narrative, output the link. If there is no link for a caption entity, report 'no link'. Do not give any explanation in your answer.

Caption

A woman with a sad face is sitting at the table, opposite her is another woman reading a newspaper.

The reddish orange sun is slightly visible at the horizon as it rises. The sky is mixed with pink and orange clouds. The ocean waves are crashing against the sand of the beach. Three people run towards the water, each holding a surfboard. A lifeguard sits near the edge of the water.

The reddish orange sun is slightly visible at the horizon as it rises. The sky is mixed with pink and orange clouds. The ocean waves are crashing against the sand of the beach. Three people run towards the water, each holding a surfboard. A lifeguard sits near the edge of the water.

Example

Input Narrative

They chose a table to sit down, while Elle read Karen a piece of bad news on the newspaper.

The three friends went to the beach at dawn to surf.

The three friends went to the beach at dawn to surf.

Caption Entity

newspaper

surfboard

clouds

Example Output

Link

newspaper −

newspaper

surfboard − surf

no link

(b)

Figure S4. Few-shot prompting demonstrations for constructing the **commonsense links** in VinaBench, including (a) visual entity extrac- tion (w.r.t. character, non-character noun and verb), and (b) link construction (w.r.t. each extracted character and non-character entity).

#### Parsing Image Appearance Style

![](data:image/png;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)

System Identify the style of the images. Your answer must be one of the following choices: photorealistic, fantasy art, digital

Prompt art, pop art, comic book, cartoon, surrealist, black and white photographic. If you are not sure, respond 'unclear'.

Example Input

Image

Example Output

Style

photorealistic

(a)

***Parsing Global Character List***

![](data:image/png;base64...)![](data:image/png;base64...)

System Prompt

Identify all characters in the following narrative. For each character, give the character's name. If the name is not mentioned, give the character's role pronoun (e.g., woman, father) instead. Only answer with a comma separated list of character names or pronouns. If you are not sure, answer 'do not know'.

Example Input

Narrative

Karen was cooking lunch on the weekend. She received a call from her friend Elle, inviting her out for lunch.

The bald man gets out of the car, and he is making some fight stance position. Jeff doesn't know what exactly the bald man is trying to do now.

Example Output

Characters

Karen, Elle

Jeff, bald man

(b)

#### Parsing Global Character Attributes

![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)

You are given a narrative and a character name. Using the narrative, give some phrases to System physically describe the character, which can include their age range, gender, social role and Prompt other sustained physical features that the narrative mentions. Do not give more information

than you can infer from the narrative.

Narrative

Karen was cooking lunch on the weekend. She received a call from her friend Elle, inviting her out for lunch.

Joseph gets out of the car, and he is making some fight stance position. Jeff doesn't know what exactly Joseph is trying to do now.

Example Input

A family goes to the store to buy milk. They cannot find any milk in the store, so Kate drove her son back home.

Character Name

Karen

Joseph

son

Example Output

Attributes

adult female

adult male

young boy, Kate's son

(c)

Figure S5. Few-shot prompting demonstrations for parsing the **global features** in VinaBench, including (a) image appearance style, (b) character list, and (c) character attributes. The output features of (b) and (c) form the global profile of characters.

***Parsing a Scene’s Presented Character Number***

![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)

System Prompt

How many characters are present in the image? Only answer an Arabic number.

Example Input

Image

Example Output

Number

1

2

2

***Names***

![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)

System There are {*character number*} characters presented in the image, who are they

Prompt according to the character list and the narrative context? Answer with a comma

separated list of character names.

Image

Example Input

Past Narrative

Karen was cooking lunch on the weekend. She received a call from her friend Elle, inviting her out for lunch. Karen met Elle outside of a restaurant.

Jeff is doing a night walk and then he sees a car with a man inside.

Narrative

They chose a table to sit down, while Elle read Karen a piece of bad news on the newspaper.

He is going to see who is inside the car.

Character List

Elle (adult female), Karen (adult female)

Joseph (adult male), Jeff (man with long hair)

Example Output

Names

Elle, Karen

Jeff

(a)

***Parsing a Scene’s Time of Day***

![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)

System Prompt

Identify the time of the image, during which the following narrative takes place. Your answer must be one of the following choices: early morning, morning, afternoon, evening, night. If the time of day is unclear in the image and narrative, answer 'unclear'.

Image

Example Input

Narrative

Kate was cooking lunch on the weekend.

Elle read Karen a piece of

r

bad news on the newspape

Joseph gets out of the car,

t

and he is making some figh

at afternoon tea.

stance position.

Example Output

Time of Day

morning

afternoon

unclear

(b)

#### Parsing a Scene’s Location

![](data:image/png;base64...)![](data:image/png;base64...)![](data:image/jpeg;base64...)![](data:image/jpeg;base64...)

System Identify the setting of the image, where the following narrative

Prompt takes place.

Image

Example Input

Narrative

Kate was cooking lunch on the weekend.

Elle read Karen a piece of bad news on the newspaper at afternoon tea.

Example Output

Location

kitchen

restaurant

(c)

Figure S6. Few-shot prompting demonstrations for parsing the **scene features** in VinaBench, including (a) presented character number and names, (b) time of day, and (c) location. In the step of parsing presented character names in (a), the span “*{character number}*” in the system prompt is replaced by the output in the prior step of parsing character number.
