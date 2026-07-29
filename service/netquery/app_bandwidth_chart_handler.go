package netquery

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// AppBandwidthChartHandler handles per-app day/week/month bandwidth chart requests.
type AppBandwidthChartHandler struct {
	Database *Database
}

// AppBandwidthChartRequest holds a request for per-app period bandwidth totals.
type AppBandwidthChartRequest struct {
	Period string `json:"period"`
	Limit  int    `json:"limit"`
}

func (ch *AppBandwidthChartHandler) ServeHTTP(resp http.ResponseWriter, req *http.Request) {
	requestPayload, err := ch.parseRequest(req)
	if err != nil {
		http.Error(resp, err.Error(), http.StatusBadRequest)
		return
	}

	period := AppBandwidthPeriod(strings.ToLower(strings.TrimSpace(requestPayload.Period)))
	if period == "" {
		period = AppBandwidthPeriodDay
	}

	result, err := ch.Database.QueryAppBandwidthByPeriod(req.Context(), period, requestPayload.Limit)
	if err != nil {
		http.Error(resp, failedQuery+err.Error(), http.StatusBadRequest)
		return
	}
	if result == nil {
		result = &AppBandwidthPeriodResult{Rows: []AppBandwidthRow{}}
	}
	if result.Rows == nil {
		result.Rows = []AppBandwidthRow{}
	}

	resp.WriteHeader(http.StatusOK)
	enc := json.NewEncoder(resp)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	_ = enc.Encode(map[string]interface{}{ //nolint:errchkjson
		"results": result.Rows,
		"totals":  result.Totals,
		"period":  period,
	})
}

func (ch *AppBandwidthChartHandler) parseRequest(req *http.Request) (*AppBandwidthChartRequest, error) {
	var body io.Reader

	switch req.Method {
	case http.MethodPost, http.MethodPut:
		body = req.Body
	case http.MethodGet:
		body = strings.NewReader(req.URL.Query().Get("q"))
	default:
		return nil, fmt.Errorf("invalid HTTP method")
	}

	blob, err := io.ReadAll(body)
	if err != nil {
		return nil, fmt.Errorf("failed to read body: %w", err)
	}

	var requestPayload AppBandwidthChartRequest
	if len(bytes.TrimSpace(blob)) == 0 {
		return &requestPayload, nil
	}

	if err := json.Unmarshal(blob, &requestPayload); err != nil && !errors.Is(err, io.EOF) {
		return nil, fmt.Errorf("invalid query: %w", err)
	}

	return &requestPayload, nil
}
