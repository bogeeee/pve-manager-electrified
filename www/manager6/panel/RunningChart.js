/*
 * This is a running chart widget you add time datapoints to it, and we only
 * show the last x of it used for ceph performance charts
 */
Ext.define('PVE.widget.RunningChart', {
    extend: 'Ext.container.Container',
    alias: 'widget.pveRunningChart',

    layout: {
        type: 'hbox',
        align: 'center',
    },
    items: [
        {
            width: 80,
            xtype: 'box',
            itemId: 'title',
            data: {
                title: '',
            },
            tpl: '<h3>{title}:</h3>',
        },
        {
            flex: 1,
            xtype: 'cartesian',
            height: '100%',
            itemId: 'chart',
            border: false,
            axes: [
                {
                    type: 'numeric',
                    position: 'left',
                    hidden: true,
                    minimum: 0,
                },
                {
                    type: 'numeric',
                    position: 'bottom',
                    hidden: true,
                },
            ],

            store: {
                trackRemoved: false,
                data: {},
            },

            sprites: [
                {
                    id: 'valueSprite',
                    type: 'text',
                    text: '0 B/s',
                    textAlign: 'end',
                    textBaseline: 'middle',
                    fontSize: 14,
                },
            ],

            series: [
                {
                    type: 'line',
                    xField: 'time',
                    yField: 'val',
                    fill: 'true',
                    colors: ['#cfcfcf'],
                    tooltip: {
                        trackMouse: true,
                        renderer: function (tooltip, record, ctx) {
                            if (!record || !record.data) {
                                return;
                            }
                            const view = this.getChart();
                            const date = new Date(record.data.time);
                            const value = view.up().renderer(record.data.val);
                            const line1 = `${view.up().title}: ${value}`;
                            const line2 = Ext.Date.format(date, 'H:i:s');
                            tooltip.setHtml(`${line1}<br />${line2}`);
                        },
                    },
                    style: {
                        lineWidth: 1.5,
                        opacity: 0.6,
                    },
                    marker: {
                        opacity: 0,
                        scaling: 0.01,
                        fx: {
                            duration: 200,
                            easing: 'easeOut',
                        },
                    },
                    highlightCfg: {
                        opacity: 1,
                        scaling: 1.5,
                    },
                },
            ],
        },
    ],

    // the renderer for the tooltip and last value, default just the value
    renderer: Ext.identityFn,

    // show the last x seconds default is 5 minutes
    timeFrame: 5 * 60,

    checkThemeColors: function () {
        let me = this;
        let rootStyle = getComputedStyle(document.documentElement);

        // get color
        let background = rootStyle.getPropertyValue('--pwt-panel-background').trim() || '#ffffff';
        let text = rootStyle.getPropertyValue('--pwt-text-color').trim() || '#000000';

        // set the colors
        me.chart.setBackground(background);
        me.chart.valuesprite.setAttributes({ fillStyle: text }, true);
        me.chart.redraw();
    },

    addDataPoint: function (value, time) {
        let view = this.chart;
        let panel = view.up();
        let now = new Date().getTime();
        let begin = new Date(now - 1000 * panel.timeFrame).getTime();

        view.store.add({
            time: time || now,
            val: value || 0,
        });

        // delete all old records when we have 20 times more datapoints
        // than seconds in our timeframe (so even a subsecond graph does
        // not trigger this often)
        //
        // records in the store do not take much space, but like this,
        // we prevent a memory leak when someone has the site open for a long time
        // with minimal graphical glitches
        if (view.store.count() > panel.timeFrame * 20) {
            let oldData = view.store.getData().createFiltered(function (item) {
                return item.data.time < begin;
            });

            view.store.remove(oldData.getRange());
        }

        view.timeaxis.setMinimum(begin);
        view.timeaxis.setMaximum(now);
        view.valuesprite.setText(panel.renderer(value || 0).toString());
        view.valuesprite.setAttributes(
            {
                x: view.getWidth() - 15,
                y: view.getHeight() / 2,
            },
            true,
        );
        view.redraw();
    },

    setTitle: function (title) {
        this.title = title;
        let titlebox = this.getComponent('title');
        titlebox.update({ title: title });
    },

    initComponent: function () {
        var me = this;
        me.callParent();

        if (me.title) {
            me.getComponent('title').update({ title: me.title });
        }
        me.chart = me.getComponent('chart');
        me.chart.timeaxis = me.chart.getAxes()[1];
        me.chart.valuesprite = me.chart.getSurface('chart').get('valueSprite');
        if (me.color) {
            me.chart.series[0].setStyle({
                fill: me.color,
                stroke: me.color,
            });
        }

        me.checkThemeColors();

        // switch colors on media query changes
        me.mediaQueryList = window.matchMedia('(prefers-color-scheme: dark)');
        me.themeListener = (e) => {
            me.checkThemeColors();
        };
        me.mediaQueryList.addEventListener('change', me.themeListener);
    },

    doDestroy: function () {
        let me = this;

        me.mediaQueryList.removeEventListener('change', me.themeListener);

        me.callParent();
    },
});
