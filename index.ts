import express from "express";
import  {tavily} from '@tavily/core';
import { Output, streamText } from 'ai';
import { PROMPT_TEMPLATE, SYSTEM_PROMPT } from "./prompts";
import z from "zod";
import { middleware } from "./middleware";
import cors from "cors";
// import {StreamText} from 'ai';



const client = tavily({ apiKey: process.env.TAVILY_API_KEY });


const app = express()

app.use(express.json());
app.use(cors)

//==========================END-POINTS=============================


//signup enpoint

app.post("/signup", async (req, res) => {

});


//login endpoint
app.post("/login", async (req, res) => {

});


//get conversation histort
app.get("/conversation", middleware, async (req, res) => {

    res.json({
        UserId: req.userId,
    })
});

app.post("/connversation:conversationId", middleware, async (req, res) => {

});



app.post("/nuelexity_ask", middleware, async (req, res) => {


    // 1- get user query
    const query =  req.body.query;
    

    // 2- then make sure user has access/credits to hit the endpoint


    // 3- check if we have websearch indexed for a similar query


    // 4- if no! then we do a web search ti gaather sources
    const webSearchResponse = await client.search(query, {
        searchDepth: "advanced"
    })


    
    const webSearchResults = webSearchResponse.results; 

    // 5- do some context engineering on prompt + web search response


    // 6- hit LLM and stream back response
    // get to the api gateway via verce-api-gateway

    const prompt = PROMPT_TEMPLATE
        .replace("{{WEB_SEARCH_RESULTS}", JSON.stringify(webSearchResults))
        .replace("{{USER_QUERY}}", query);

     const result = streamText({
        model: 'openai/gpt-5.4',
        prompt: prompt,
        system: SYSTEM_PROMPT
    });


    // 7- also stream back sources and folllow up questions (which we can get from another parallel LLM call)

        output: Output.object({
        schema: z.object({
        followUps: z.array(z.string()),
            answer: z.string()
        }),
    })

    res.header("Cache-Control", "no-cache");
    res.header("Content-Type", "text/event-stream");
    

    for await (const textPart of result.textStream) {
        res.end(textPart) 
    }



    res.write("<SOURCES>")

    //  webSearchResults.forEach(result => res.write(JSON.stringify(result)));
     res.write(JSON.stringify(webSearchResults.map(result => ({url: result.url}))))

    res.write("<SOURCES/>")


    // 8- close the event stream

    res.end();
});


//we create 2nd request for user follow up questions so it is connected
app.post("/nuelexity_ask/follow_up", middleware, async (req, res) => {

    // 1- get existing chat/context from db
    // 2- forward history to the LLM
    // 3- Do some context engineering perhaps!
    // 4- stream response to user
});



    //non-conceptual dummy----> endpoint
app.post("/requestlity_nuelexity", async (req, res) => {
    
    // SSE setup
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    res.flushHeaders();

    const dummy = req.body.dummy;

    res.write(`data: Starting...\n\n`);

    res.write(`data: ${dummy}\n\n`);

    res.write(`data: Why is this not a way to run the same request for _ask\n\n`);

    res.write(`data: Finished!\n\n`);

    res.end();

    res.end();
});


app.listen(3002);

