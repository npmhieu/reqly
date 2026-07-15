export namespace db {
	
	export class RequestHistory {
	    id: number;
	    url: string;
	    method: string;
	    headers: string;
	    body_type: string;
	    body: string;
	    form_data: string;
	    response_status: number;
	    response_body: string;
	    response_headers: string;
	    duration_ms: number;
	    // Go type: time
	    created_at: any;
	    tags: string[];
	
	    static createFrom(source: any = {}) {
	        return new RequestHistory(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.url = source["url"];
	        this.method = source["method"];
	        this.headers = source["headers"];
	        this.body_type = source["body_type"];
	        this.body = source["body"];
	        this.form_data = source["form_data"];
	        this.response_status = source["response_status"];
	        this.response_body = source["response_body"];
	        this.response_headers = source["response_headers"];
	        this.duration_ms = source["duration_ms"];
	        this.created_at = this.convertValues(source["created_at"], null);
	        this.tags = source["tags"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace engine {
	
	export class FormDataItem {
	    key: string;
	    value: string;
	    type: string;
	
	    static createFrom(source: any = {}) {
	        return new FormDataItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.value = source["value"];
	        this.type = source["type"];
	    }
	}
	export class HTTPRequest {
	    url: string;
	    method: string;
	    headers: Record<string, string>;
	    body_type: string;
	    body: string;
	    form_data: FormDataItem[];
	
	    static createFrom(source: any = {}) {
	        return new HTTPRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.url = source["url"];
	        this.method = source["method"];
	        this.headers = source["headers"];
	        this.body_type = source["body_type"];
	        this.body = source["body"];
	        this.form_data = this.convertValues(source["form_data"], FormDataItem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class HTTPResponse {
	    status: number;
	    status_text: string;
	    headers: Record<string, string>;
	    body: string;
	    duration_ms: number;
	
	    static createFrom(source: any = {}) {
	        return new HTTPResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.status = source["status"];
	        this.status_text = source["status_text"];
	        this.headers = source["headers"];
	        this.body = source["body"];
	        this.duration_ms = source["duration_ms"];
	    }
	}

}

