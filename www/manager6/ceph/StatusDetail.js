Ext.define('PVE.ceph.StatusDetail', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pveCephStatusDetail',

    layout: {
        type: 'hbox',
        align: 'stretch',
    },

    bodyPadding: '0 5',
    defaults: {
        xtype: 'box',
        style: {
            'text-align': 'center',
        },
    },

    items: [
        {
            flex: 1,
            itemId: 'osds',
            maxHeight: 250,
            scrollable: true,
            padding: '0 10 5 10',
            data: {
                total: 0,
                upin: 0,
                upout: 0,
                downin: 0,
                downout: 0,
                oldOSD: [],
                ghostOSD: [],
            },
            tpl: [
                '<h3>OSDs</h3>',
                '<table class="osds">',
                '<tr><td></td>',
                '<td><i class="fa fa-fw good fa-circle"></i>',
                gettext('In'),
                '</td>',
                '<td><i class="fa fa-fw warning fa-circle-o"></i>',
                gettext('Out'),
                '</td>',
                '</tr>',
                '<tr>',
                '<td><i class="fa fa-fw good fa-arrow-circle-up"></i>',
                gettext('Up'),
                '</td>',
                '<td>{upin}</td>',
                '<td>{upout}</td>',
                '</tr>',
                '<tr>',
                '<td><i class="fa fa-fw critical fa-arrow-circle-down"></i>',
                gettext('Down'),
                '</td>',
                '<td>{downin}</td>',
                '<td>{downout}</td>',
                '</tr>',
                '</table>',
                '<br /><div>',
                gettext('Total'),
                ': {total}',
                '</div><br />',
                '<tpl if="oldOSD.length &gt; 0">',
                '<i class="fa fa-refresh warning"></i> ' + gettext('Outdated OSDs') + '<br>',
                '<div class="osds">',
                '<tpl for="oldOSD">',
                '<div class="left-aligned">osd.{id}:</div>',
                '<div class="right-aligned">{version}</div><br />',
                '<div style="clear:both"></div>',
                '</tpl>',
                '</div>',
                '</tpl>',
                '</div>',
                '<tpl if="ghostOSD.length &gt; 0">',
                '<br />',
                `<i class="fa fa-question-circle warning"></i> ${gettext('Ghost OSDs')}<br>`,
                `<div data-qtip="${gettext('OSDs with no metadata, possibly left over from removal')}" class="osds">`,
                '<tpl for="ghostOSD">',
                '<div class="left-aligned">osd.{id}</div>',
                '<div style="clear:both"></div>',
                '</tpl>',
                '</div>',
                '</tpl>',
            ],
        },
        {
            flex: 1,
            border: false,
            itemId: 'pgchart',
            xtype: 'polar',
            height: 184,
            innerPadding: 5,
            insetPadding: 5,
            colors: ['#CFCFCF', '#21BF4B', '#3892d4', '#FFCC00', '#FF6C59'],
            store: {},
            series: [
                {
                    type: 'pie',
                    donut: 60,
                    angleField: 'count',
                    tooltip: {
                        trackMouse: true,
                        renderer: function (tooltip, record, ctx) {
                            var html = record.get('text');
                            html += '<br>';
                            record.get('states').forEach(function (state) {
                                html += '<br>' + state.state_name + ': ' + state.count.toString();
                            });
                            tooltip.setHtml(html);
                        },
                    },
                    subStyle: {
                        strokeStyle: false,
                    },
                },
            ],
        },
        {
            flex: 1.6,
            itemId: 'pgs',
            padding: '0 10',
            maxHeight: 250,
            scrollable: true,
            data: {
                states: [],
            },
            tpl: [
                '<h3>PGs</h3>',
                '<tpl for="states">',
                '<div class="left-aligned"><i class ="fa fa-circle {cls}"></i> {state_name}:</div>',
                '<div class="right-aligned">{count}</div><br />',
                '<div style="clear:both"></div>',
                '</tpl>',
            ],
        },
    ],

    // similar to mgr dashboard
    pgstates: {
        // clean
        clean: 1,
        active: 1,

        // busy
        activating: 2,
        backfill_wait: 2,
        backfilling: 2,
        creating: 2,
        deep: 2,
        forced_backfill: 2,
        forced_recovery: 2,
        peered: 2,
        peering: 2,
        recovering: 2,
        recovery_wait: 2,
        remapped: 2,
        repair: 2,
        scrubbing: 2,
        snaptrim: 2,
        snaptrim_wait: 2,

        // warning
        degraded: 3,
        undersized: 3,

        // critical
        backfill_toofull: 4,
        backfill_unfound: 4,
        down: 4,
        incomplete: 4,
        inconsistent: 4,
        recovery_toofull: 4,
        recovery_unfound: 4,
        snaptrim_error: 4,
        stale: 4,
    },

    statecategories: [
        {
            text: gettext('Unknown'),
            count: 0,
            states: [],
            cls: 'faded',
        },
        {
            text: gettext('Clean'),
            cls: 'good',
        },
        {
            text: gettext('Busy'),
            cls: 'pve-ceph-status-busy',
        },
        {
            text: ngettext('Warning', 'Warnings', 1),
            cls: 'warning',
        },
        {
            text: gettext('Critical'),
            cls: 'critical',
        },
    ],

    checkThemeColors: function () {
        let me = this;
        let rootStyle = getComputedStyle(document.documentElement);

        // get color
        let background = rootStyle.getPropertyValue('--pwt-panel-background').trim() || '#ffffff';

        // set the colors
        me.chart.setBackground(background);
        me.chart.redraw();
    },

    updateAll: function (metadata, status) {
        let me = this;
        me.suspendLayout = true;

        let maxversion = '0';
        Object.values(metadata.node || {}).forEach(function (node) {
            if (PVE.Utils.compare_ceph_versions(node?.version?.parts, maxversion) > 0) {
                maxversion = node.version.parts;
            }
        });

        let oldOSD = [],
            ghostOSD = [];
        metadata.osd?.forEach((osd) => {
            let version = PVE.Utils.parse_ceph_version(osd);
            if (version !== undefined) {
                if (PVE.Utils.compare_ceph_versions(version, maxversion) !== 0) {
                    oldOSD.push({
                        id: osd.id,
                        version: version,
                    });
                }
            } else {
                if (Object.keys(osd).length > 1) {
                    console.warn('got OSD entry with no valid version but other keys', osd);
                }
                ghostOSD.push({
                    id: osd.id,
                });
            }
        });

        // update PGs sorted
        let pgmap = status.pgmap || {};
        let pgs_by_state = pgmap.pgs_by_state || [];
        pgs_by_state.sort(function (a, b) {
            return a.state_name < b.state_name ? -1 : a.state_name === b.state_name ? 0 : 1;
        });

        me.statecategories.forEach(function (cat) {
            cat.count = 0;
            cat.states = [];
        });

        pgs_by_state.forEach(function (state) {
            let states = state.state_name.split(/[^a-z]+/);
            let result = 0;
            for (let i = 0; i < states.length; i++) {
                if (me.pgstates[states[i]] > result) {
                    result = me.pgstates[states[i]];
                }
            }
            // for the list
            state.cls = me.statecategories[result].cls;

            me.statecategories[result].count += state.count;
            me.statecategories[result].states.push(state);
        });

        me.chart.getStore().setData(me.statecategories);
        me.getComponent('pgs').update({ states: pgs_by_state });

        let health = status.health || {};
        // we collect monitor/osd information from the checks
        const downinregex = /(\d+) osds down/;
        let downin_osds = 0;
        Ext.Object.each(health.checks, function (key, value, obj) {
            var found = null;
            if (key === 'OSD_DOWN') {
                found = value.summary.message.match(downinregex);
                if (found !== null) {
                    downin_osds = parseInt(found[1], 10);
                }
            }
        });

        let osdmap = status.osdmap || {};
        if (typeof osdmap.osdmap !== 'undefined') {
            osdmap = osdmap.osdmap;
        }
        // update OSDs counts
        let total_osds = osdmap.num_osds || 0;
        let in_osds = osdmap.num_in_osds || 0;
        let up_osds = osdmap.num_up_osds || 0;
        let down_osds = total_osds - up_osds;

        let downout_osds = down_osds - downin_osds;
        let upin_osds = in_osds - downin_osds;
        let upout_osds = up_osds - upin_osds;

        let osds = {
            total: total_osds,
            upin: upin_osds,
            upout: upout_osds,
            downin: downin_osds,
            downout: downout_osds,
            oldOSD: oldOSD,
            ghostOSD,
        };
        let osdcomponent = me.getComponent('osds');
        osdcomponent.update(Ext.apply(osdcomponent.data, osds));

        me.suspendLayout = false;
        me.updateLayout();
    },

    initComponent: function () {
        var me = this;
        me.callParent();

        me.chart = me.getComponent('pgchart');
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
