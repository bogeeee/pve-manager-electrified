Ext.define('PVE.sdn.RouteMapEntry', {
    extend: 'Ext.data.Model',
    fields: ['route-map-id', 'order', 'action', 'match', 'set', 'exit-action', 'pending'],

    getRouteMapId: function () {
        let me = this;
        return me.data.pending?.['route-map-id'] ?? me.data['route-map-id'];
    },

    getOrder: function () {
        let me = this;
        return me.data.pending?.order ?? me.data.order;
    },
});

Ext.define('PVE.sdn.RouteMapExitAction', {
    extend: 'Ext.data.Model',
    fields: ['key', 'value'],
});

Ext.define('PVE.sdn.RouteMapSet', {
    extend: 'Ext.data.Model',
    fields: ['key', 'value'],
});

Ext.define('PVE.sdn.RouteMapSetValueField', {
    extend: 'Ext.container.Container',
    mixins: ['Ext.form.field.Field'],

    alias: ['widget.pveSdnRouteMapSetValueField'],

    layout: 'vbox',

    config: {
        record: null,
    },

    publishes: {
        record: true,
    },

    defaults: {
        width: '100%',
    },

    viewModel: {
        data: {
            selectedKey: null,
        },
    },

    items: [],

    getWidgetForKey: function (key) {
        const widgets = {
            'ip-next-hop-peer-address': {
                xtype: 'displayfield',
            },
            'ip-next-hop': {
                xtype: 'proxmoxtextfield',
                vtype: 'IPAddress',
                bind: {
                    value: '{record.value}',
                },
            },
            'ip-next-hop-unchanged': {
                xtype: 'displayfield',
            },
            'ip6-next-hop-peer-address': {
                xtype: 'displayfield',
            },
            'ip6-next-hop-prefer-global': {
                xtype: 'displayfield',
            },
            'ip6-next-hop': {
                xtype: 'proxmoxtextfield',
                vtype: 'IP6Address',
                bind: {
                    value: '{record.value}',
                },
            },
            'local-preference': {
                xtype: 'proxmoxtextfield',
                regex: /^[+-]?\d+$/,
                regexText: gettext(
                    'A number; prefix with + or - to add or subtract from the current value.',
                ),
                bind: {
                    value: '{record.value}',
                },
                listeners: {
                    change: function (field, newValue) {
                        field
                            .up('pveSdnRouteMapSetValueField')
                            ?.getRecord()
                            ?.set('value', newValue);
                    },
                },
            },
            tag: {
                xtype: 'proxmoxtextfield',
                regex: /^(\d+|untagged)$/,
                regexText: gettext('A number, or the literal "untagged".'),
                bind: {
                    value: '{record.value}',
                },
                listeners: {
                    change: function (field, newValue) {
                        field
                            .up('pveSdnRouteMapSetValueField')
                            ?.getRecord()
                            ?.set('value', newValue);
                    },
                },
            },
            weight: {
                xtype: 'proxmoxintegerfield',
                minValue: 1,
                maxValue: 2 ** 32 - 1,
                step: 1,
                bind: {
                    value: '{record.value}',
                },
            },
            metric: {
                xtype: 'proxmoxtextfield',
                regex: /^([+-]?\d+|[+-]?rtt|igp|aigp)$/,
                regexText: gettext(
                    'A number, "rtt", "igp" or "aigp"; numbers and rtt may be prefixed with + or -.',
                ),
                bind: {
                    value: '{record.value}',
                },
                listeners: {
                    change: function (field, newValue) {
                        field
                            .up('pveSdnRouteMapSetValueField')
                            ?.getRecord()
                            ?.set('value', newValue);
                    },
                },
            },
            src: {
                xtype: 'proxmoxtextfield',
                vtype: 'IP64Address',
                bind: {
                    value: '{record.value}',
                },
            },
        };

        return (
            widgets[key] ?? {
                xtype: 'displayfield',
            }
        );
    },

    applyRecord: function (record) {
        let me = this;

        if (record.data.key === me.getViewModel().get('selectedKey')) {
            return;
        }
        me.getViewModel().set('selectedKey', record.data.key);

        me.removeAll();

        let widget = me.getWidgetForKey(record.data.key);

        if (widget.xtype === 'displayfield') {
            me.getRecord()?.set('value', null);
        }

        me.add(widget);

        return record;
    },
});

const ROUTE_MAP_SET_ACTION_LABELS = {
    'ip-next-hop': gettext('IPv4 next-hop'),
    'ip-next-hop-peer-address': gettext('IPv4 next-hop to peer address'),
    'ip-next-hop-unchanged': gettext('IPv4 next-hop unchanged'),
    'ip6-next-hop': gettext('IPv6 next-hop'),
    'ip6-next-hop-peer-address': gettext('IPv6 next-hop to peer address'),
    'ip6-next-hop-prefer-global': gettext('IPv6 next-hop to global address'),
    'local-preference': gettext('Local Preference'),
    tag: gettext('Tag'),
    weight: gettext('Weight'),
    metric: gettext('Metric'),
    src: gettext('Source'),
};

Ext.define('PVE.sdn.RouteMapSetField', {
    extend: 'Ext.grid.Panel',
    mixins: ['Ext.form.field.Field'],
    alias: 'widget.pveSdnRouteMapSetField',

    emptyText: gettext('No set actions configured.'),

    isCreate: false,

    store: {
        model: 'PVE.sdn.RouteMapSet',
    },

    columns: [
        {
            header: gettext('Property'),
            xtype: 'widgetcolumn',
            flex: 1,
            widget: {
                xtype: 'proxmoxKVComboBox',
                comboItems: Object.entries(ROUTE_MAP_SET_ACTION_LABELS),
                allowBlank: false,
                deleteEmpty: false,
                bind: {
                    value: '{record.key}',
                },
                listeners: {
                    select: function (_this, newValue) {
                        let me = this;
                        me.getWidgetRecord().set('key', newValue.id);
                    },
                },
            },
        },
        {
            header: gettext('Value'),
            flex: 1,
            xtype: 'widgetcolumn',
            tdCls: 'x-textfield-default-cell',
            widget: {
                xtype: 'pveSdnRouteMapSetValueField',
                bind: {
                    record: {
                        bindTo: '{record}',
                        deep: true,
                    },
                },
            },
        },
        {
            width: 40,
            xtype: 'widgetcolumn',
            widget: {
                xtype: 'button',
                tooltip: gettext('Delete'),
                handler: 'deleteSet',
                iconCls: 'fa fa-trash-o',
            },
        },
    ],

    initComponent: function () {
        let me = this;
        me.callParent();

        me.getStore().on('datachanged', function () {
            me.fireEvent('dirtychange');
        });
    },

    getValue: function () {
        let me = this;

        return me
            .getStore()
            .getData()
            .items.map((item) => {
                let data = item.data;
                delete data.id;

                if (!data.value) {
                    delete data.value;
                }

                return PVE.Parser.printPropertyString(data);
            });
    },

    setValue: function (value) {
        let me = this;
        me.getStore().setData(value.map(PVE.Parser.parsePropertyString));
    },

    getSubmitData: function () {
        let me = this;
        let value = me.getValue();

        if (value.length === 0) {
            return {
                delete: [me.getName()],
            };
        }

        return {
            [me.getName()]: value,
        };
    },

    bbar: [
        {
            xtype: 'button',
            text: gettext('Add'),
            iconCls: 'fa fa-plus-circle',
            handler: 'addEntry',
        },
    ],

    controller: {
        addEntry: function () {
            let me = this;
            me.getView().getStore().add({
                key: null,
                value: null,
            });
        },
        deleteSet: function (btn) {
            let me = this;
            let record = btn.getWidgetRecord();
            me.getView().getStore().remove(record);
        },
    },
});

Ext.define('PVE.sdn.RouteMapMatch', {
    extend: 'Ext.data.Model',
    fields: ['key', 'value'],
});

Ext.define('PVE.sdn.RouteMapMatchValueField', {
    extend: 'Ext.container.Container',
    mixins: ['Ext.form.field.Field'],

    alias: ['widget.pveSdnRouteMapMatchValueField'],

    layout: 'vbox',

    config: {
        key: null,
        record: null,
    },

    publishes: {
        record: true,
    },

    defaults: {
        name: 'value',
        width: '100%',
        bind: {
            value: '{record.value}',
        },
    },

    items: [],

    getWidgetForKey: function (key) {
        const widgets = {
            'route-type': {
                xtype: 'proxmoxKVComboBox',
                comboItems: [
                    ['ead', gettext('Ethernet Auto-Discovery (Type 1)')],
                    ['macip', gettext('MAC/IP Advertisement (Type 2)')],
                    ['multicast', gettext('Inclusive Multicast (Type 3)')],
                    ['es', gettext('Ethernet Segment (Type 4)')],
                    ['prefix', gettext('IP Prefix (Type 5)')],
                ],
                allowBlank: false,
                deleteEmpty: false,
            },
            vni: {
                xtype: 'proxmoxintegerfield',
                flex: 1,
                minValue: 1,
                maxValue: 2 ** 24 - 1,
                step: 1,
            },
            'ip-address-prefix-list': {
                xtype: 'pveSDNPrefixListSelector',
            },
            'ip6-address-prefix-list': {
                xtype: 'pveSDNPrefixListSelector',
            },
            'ip-next-hop-prefix-list': {
                xtype: 'pveSDNPrefixListSelector',
            },
            'ip6-next-hop-prefix-list': {
                xtype: 'pveSDNPrefixListSelector',
            },
            'ip-next-hop-address': {
                xtype: 'proxmoxtextfield',
                vtype: 'IPAddress',
            },
            'ip6-next-hop-address': {
                xtype: 'proxmoxtextfield',
                vtype: 'IP6Address',
            },
            tag: {
                xtype: 'proxmoxintegerfield',
                minValue: 0,
                maxValue: 2 ** 32 - 1,
                step: 1,
            },
            metric: {
                xtype: 'proxmoxintegerfield',
                minValue: 1,
                maxValue: 2 ** 32 - 1,
                step: 1,
            },
            'local-preference': {
                xtype: 'proxmoxintegerfield',
                minValue: 1,
                maxValue: 2 ** 32 - 1,
                step: 1,
            },
            peer: {
                xtype: 'proxmoxtextfield',
            },
        };

        return (
            widgets[key] ?? {
                xtype: 'displayfield',
            }
        );
    },

    updateKey: function (key) {
        let me = this;

        me.removeAll();
        me.add(me.getWidgetForKey(key));

        return key;
    },
});

const ROUTE_MAP_MATCH_ACTION_LABELS = {
    'route-type': gettext('Route Type'),
    vni: gettext('VNI'),
    'ip-address-prefix-list': gettext('IPv4 (prefix-list)'),
    'ip6-address-prefix-list': gettext('IPv6 (prefix-list)'),
    'ip-next-hop-prefix-list': gettext('IPv4 next-hop (prefix-list)'),
    'ip6-next-hop-prefix-list': gettext('IPv6 next-hop (prefix-list)'),
    'ip-next-hop-address': gettext('IPv4 next-hop'),
    'ip6-next-hop-address': gettext('IPv6 next-hop'),
    metric: gettext('Metric'),
    'local-preference': gettext('Local Preference'),
    peer: gettext('Peer'),
    tag: gettext('Tag'),
};

Ext.define('PVE.sdn.RouteMapMatchField', {
    extend: 'Ext.grid.Panel',
    mixins: ['Ext.form.field.Field'],
    alias: 'widget.pveSdnRouteMapMatchField',

    emptyText: gettext('No match actions configured.'),

    isCreate: false,

    store: {
        model: 'PVE.sdn.RouteMapMatch',
    },

    columns: [
        {
            header: gettext('Property'),
            xtype: 'widgetcolumn',
            flex: 1,
            widget: {
                xtype: 'proxmoxKVComboBox',
                comboItems: Object.entries(ROUTE_MAP_MATCH_ACTION_LABELS),
                allowBlank: false,
                deleteEmpty: false,
                bind: {
                    value: '{record.key}',
                },
                listeners: {
                    select: function (_this, newValue) {
                        let me = this;
                        me.getWidgetRecord().set('key', newValue.id);
                    },
                },
            },
        },
        {
            header: gettext('Value'),
            flex: 1,
            xtype: 'widgetcolumn',
            tdCls: 'x-textfield-default-cell',
            widget: {
                xtype: 'pveSdnRouteMapMatchValueField',
                bind: {
                    key: '{record.key}',
                    record: '{record}',
                },
            },
        },
        {
            width: 40,
            xtype: 'widgetcolumn',
            widget: {
                xtype: 'button',
                tooltip: gettext('Delete'),
                handler: 'deleteMatch',
                iconCls: 'fa fa-trash-o',
            },
        },
    ],

    initComponent: function () {
        let me = this;
        me.callParent();

        me.getStore().on('datachanged', function () {
            me.fireEvent('validitychange');
            me.fireEvent('dirtychange');
        });
    },

    getValue: function () {
        let me = this;

        return me
            .getStore()
            .getData()
            .items.map((item) => {
                let data = item.data;
                delete data.id;

                if (!data.value) {
                    delete data.value;
                }

                return PVE.Parser.printPropertyString(data);
            });
    },

    setValue: function (value) {
        let me = this;
        me.getStore().setData(value.map(PVE.Parser.parsePropertyString));
    },

    getSubmitData: function () {
        let me = this;

        let value = me.getValue();
        if (value.length === 0) {
            return {
                delete: [me.getName()],
            };
        }

        return {
            [me.getName()]: value,
        };
    },

    bbar: [
        {
            xtype: 'button',
            text: gettext('Add'),
            iconCls: 'fa fa-plus-circle',
            handler: 'addEntry',
        },
    ],

    controller: {
        addEntry: function () {
            let me = this;
            me.getView().getStore().add({
                key: null,
                value: null,
            });
        },
        deleteMatch: function (btn) {
            let me = this;
            let record = btn.getWidgetRecord();
            me.getView().getStore().remove(record);
        },
    },
});

Ext.define('PVE.sdn.RouteMapExitActionField', {
    extend: 'Ext.container.Container',
    mixins: ['Ext.form.field.Field'],
    alias: 'widget.pveSdnRouteMapExitActionField',

    layout: 'hbox',

    viewModel: {
        data: {
            exitAction: { key: '__default__' },
        },
        formulas: {
            needsOrderValue: (get) => {
                let key = get('exitAction.key');
                return key === 'on-match-goto' || key === 'continue';
            },
        },
    },

    items: [
        {
            xtype: 'proxmoxKVComboBox',
            flex: 1,
            fieldLabel: gettext('Exit Policy'),
            bind: {
                value: '{exitAction.key}',
            },
            comboItems: [
                ['__default__', Proxmox.Utils.defaultText + gettext('(exit)')],
                ['on-match-next', gettext('On match next')],
                ['on-match-goto', gettext('On match goto')],
                ['continue', gettext('Continue')],
            ],
            deleteEmpty: false,
            editable: false,
            isFormField: false,
        },
        {
            xtype: 'proxmoxintegerfield',
            flex: 1,
            emptyText: gettext('Target order'),
            minValue: 1,
            maxValue: 2 ** 16 - 1,
            step: 1,
            isFormField: false,
            margin: '0 0 0 5',
            hidden: true,
            disabled: true,
            allowBlank: false,
            bind: {
                value: '{exitAction.value}',
                hidden: '{!needsOrderValue}',
                disabled: '{!needsOrderValue}',
            },
        },
    ],

    initComponent: function () {
        let me = this;
        me.callParent(arguments);
        // React to viewModel changes rather than child widget events: the
        // viewModel notifies subscribers *after* two-way bind sync, so the
        // callback always sees the current state (avoids a race where the
        // listener would otherwise fire before bind propagates the new value).
        me.getViewModel().bind({ bindTo: '{exitAction}', deep: true }, () => {
            me.fireEvent('dirtychange');
            me.validate();
        });
    },

    getErrors: function () {
        let me = this;
        let exitAction = me.getViewModel().get('exitAction') || {};
        let key = exitAction.key;
        if (
            (key === 'on-match-goto' || key === 'continue') &&
            (exitAction.value === undefined || exitAction.value === null || exitAction.value === '')
        ) {
            return [gettext('Target order is required')];
        }
        return [];
    },

    getValue: function () {
        let me = this;
        let exitAction = me.getViewModel().get('exitAction');
        if (!exitAction?.key || exitAction.key === '__default__') {
            return null;
        }
        // strip stale value when switching back to a unit variant after entering a value
        let out = { key: exitAction.key };
        if (exitAction.key === 'on-match-goto' || exitAction.key === 'continue') {
            out.value = exitAction.value;
        }
        return PVE.Parser.printPropertyString(out);
    },

    setValue: function (value) {
        let me = this;
        let exitAction = value ? PVE.Parser.parsePropertyString(value) : { key: '__default__' };
        me.getViewModel().set('exitAction', exitAction);
        me.resetOriginalValue();
    },

    getSubmitData: function () {
        let me = this;

        let value = me.getValue();

        if (!value) {
            return {
                delete: [me.getName()],
            };
        }

        return {
            [me.getName()]: value,
        };
    },
});

Ext.define('PVE.sdn.EditRouteMapEntryWindow', {
    extend: 'Proxmox.window.Edit',
    // TRANSLATORS: "Route map" refers to an FRR route map, some languages may
    // prefer to keep it as-is:
    // https://docs.frrouting.org/en/latest/routemap.html
    subject: gettext('Route Map Entry'),

    onlineHelp: 'pvesdn_config_route_maps',

    initComponent: function () {
        let me = this;
        me.method = me.isCreate ? 'POST' : 'PUT';

        me.callParent();
    },

    loadUrl: function () {
        let me = this;
        return `/api2/extjs/cluster/sdn/route-maps/entries/${me.getRouteMapId()}/entry/${me.getOrder()}`;
    },

    submitUrl: function () {
        let me = this;

        if (me.isCreate) {
            return '/api2/extjs/cluster/sdn/route-maps/entries';
        } else {
            return `/api2/extjs/cluster/sdn/route-maps/entries/${me.getRouteMapId()}/entry/${me.getOrder()}`;
        }
    },

    width: 600,

    viewModel: {
        formulas: {
            routeMapId: function (get) {
                let me = this;
                return me.getView().getRouteMapId();
            },
            order: function (get) {
                let me = this;
                return me.getView().getOrder();
            },
        },
    },

    config: {
        routeMapId: null,
        order: null,
    },

    isCreate: false,

    items: [
        {
            xtype: 'pveSDNRouteMapSelector',
            name: 'route-map-id',
            // TRANSLATORS: "Route map" refers to an FRR route map, some
            // languages may prefer to keep it as-is:
            // https://docs.frrouting.org/en/latest/routemap.html
            fieldLabel: gettext('Route Map ID'),
            editable: true,
            notFoundIsValid: true,
            allowBlank: false,
            bind: {
                disabled: '{routeMapId}',
            },
        },
        {
            xtype: 'proxmoxintegerfield',
            name: 'order',
            fieldLabel: gettext('Order'),
            allowBlank: false,
            bind: {
                disabled: '{order}',
            },
        },
        {
            xtype: 'proxmoxKVComboBox',
            fieldLabel: gettext('Action'),
            name: 'action',
            comboItems: [
                ['permit', gettext('Permit')],
                ['deny', gettext('Deny')],
            ],
            allowBlank: false,
        },
        {
            xtype: 'fieldcontainer',
            fieldLabel: gettext('Match'),
            items: [
                {
                    xtype: 'pveSdnRouteMapMatchField',
                    name: 'match',
                },
            ],
        },
        {
            xtype: 'fieldcontainer',
            fieldLabel: gettext('Set'),
            items: [
                {
                    xtype: 'pveSdnRouteMapSetField',
                    name: 'set',
                },
            ],
        },
        {
            xtype: 'pveSDNRouteMapSelector',
            fieldLabel: gettext('Call'),
            name: 'call',
            deleteEmpty: true,
            skipEmptyText: true,
        },
        {
            xtype: 'pveSdnRouteMapExitActionField',
            fieldLabel: gettext('Exit Policy'),
            name: 'exit-action',
        },
    ],
});

Ext.define('PVE.sdn.RouteMapPanel', {
    extend: 'Ext.grid.Panel',
    alias: ['widget.pveSDNRouteMaps'],

    // TRANSLATORS: "Route map" refers to an FRR route map, some languages may
    // prefer to keep it as-is:
    // https://docs.frrouting.org/en/latest/routemap.html
    emptyText: gettext('No route maps configured.'),
    onlineHelp: 'pvesdn_config_route_maps',

    store: {
        autoLoad: true,
        model: 'PVE.sdn.RouteMapEntry',
        proxy: {
            type: 'proxmox',
            url: '/api2/extjs/cluster/sdn/route-maps/entries?pending=1',
        },
        sorters: [
            {
                property: 'route-map-id',
                direction: 'ASC',
            },
            {
                property: 'order',
                direction: 'ASC',
            },
        ],
    },

    viewModel: {
        formulas: {
            selection: function (get) {
                let me = this;

                let selection = me.getView().getSelection();
                return selection.length > 0 ? selection[0] : null;
            },
        },
    },

    listeners: {
        itemdblclick: 'editRouteMapEntry',
    },

    controller: {
        reload: function () {
            let me = this;
            me.getView().getStore().load();
        },
        addRouteMapEntry: function () {
            let me = this;

            Ext.create('PVE.sdn.EditRouteMapEntryWindow', {
                autoShow: true,
                isCreate: true,
                listeners: {
                    close: function () {
                        me.reload();
                    },
                },
            });
        },
        removeRouteMapEntry: function () {
            let me = this;

            let entry = me.getView().getSelection()[0];

            if (!entry) {
                console.warn('no route map entry selected!');
                return;
            }

            Ext.Msg.show({
                title: gettext('Confirm'),
                icon: Ext.Msg.WARNING,
                // TRANSLATORS: "Route map" refers to an FRR route map, some
                // languages may prefer to keep it as-is:
                // https://docs.frrouting.org/en/latest/routemap.html
                message: gettext('Remove route map entry?'),
                buttons: Ext.Msg.YESNO,
                defaultFocus: 'no',
                callback: function (btn) {
                    if (btn !== 'yes') {
                        return;
                    }

                    Proxmox.Async.api2({
                        url: `/api2/extjs/cluster/sdn/route-maps/entries/${entry.getRouteMapId()}/entry/${entry.getOrder()}`,
                        method: 'DELETE',
                    })
                        .catch(Proxmox.Utils.alertResponseFailure)
                        .finally(() => {
                            me.reload();
                        });
                },
            });
        },
        editRouteMapEntry: function () {
            let me = this;

            let entry = me.getView().getSelection()[0];

            if (!entry) {
                console.warn('no route map entry selected!');
                return;
            }

            Ext.create('PVE.sdn.EditRouteMapEntryWindow', {
                autoShow: true,
                autoLoad: true,
                isCreate: false,
                routeMapId: entry.getRouteMapId(),
                order: entry.getOrder(),
                listeners: {
                    close: function () {
                        me.reload();
                    },
                },
            });
        },
    },

    tbar: [
        {
            text: gettext('Add'),
            xtype: 'button',
            handler: 'addRouteMapEntry',
        },
        {
            text: gettext('Edit'),
            xtype: 'proxmoxButton',
            handler: 'editRouteMapEntry',
            bind: {
                disabled: '{!selection}',
            },
        },
        {
            text: gettext('Remove'),
            xtype: 'proxmoxButton',
            handler: 'removeRouteMapEntry',
            bind: {
                disabled: '{!selection}',
            },
        },
        {
            text: gettext('Reload'),
            xtype: 'button',
            handler: 'reload',
        },
    ],

    columns: [
        {
            text: gettext('Name'),
            dataIndex: 'route-map-id',
            flex: 1,
            renderer: function (value, metaData, rec) {
                return PVE.Utils.render_sdn_pending(rec, value, 'route-map-id', 1);
            },
        },
        {
            text: gettext('Order'),
            dataIndex: 'order',
            width: 50,
            renderer: function (value, metaData, rec) {
                return PVE.Utils.render_sdn_pending(rec, value, 'order', 1);
            },
        },
        {
            text: gettext('Action'),
            dataIndex: 'action',
            width: 80,
            renderer: function (value, metaData, rec) {
                return PVE.Utils.render_sdn_pending(rec, value, 'action', 1);
            },
        },
        {
            text: gettext('Match'),
            dataIndex: 'match',
            flex: 1,
            renderer: function (value, metaData, rec) {
                let actions = rec.data.pending?.match ?? rec.data.match ?? [];

                return actions
                    .map(PVE.Parser.parsePropertyString)
                    .map((match) => {
                        let label = ROUTE_MAP_MATCH_ACTION_LABELS[match.key] ?? match.key;
                        let value = match.value ? `: ${match.value}` : '';
                        return Ext.htmlEncode(`${label}${value}`);
                    })
                    .join('<br>');
            },
        },
        {
            text: gettext('Set'),
            dataIndex: 'set',
            flex: 1,
            renderer: function (value, metaData, rec) {
                let actions = rec.data.pending?.set ?? rec.data.set ?? [];

                return actions
                    .map(PVE.Parser.parsePropertyString)
                    .map((match) => {
                        let label = ROUTE_MAP_SET_ACTION_LABELS[match.key] ?? match.key;
                        let value = match.value ? `: ${match.value}` : '';
                        return Ext.htmlEncode(`${label}${value}`);
                    })
                    .join('<br>');
            },
        },
        {
            text: gettext('Call'),
            dataIndex: 'call',
            flex: 1,
            renderer: function (value, metaData, rec) {
                return PVE.Utils.render_sdn_pending(rec, value, 'call', 1);
            },
        },
        {
            header: gettext('Exit Policy'),
            width: 100,
            dataIndex: 'exit-action',
            renderer: function (value, metaData, rec) {
                let exitAction = rec.data.pending?.['exit-action'] ?? rec.data['exit-action'];

                if (exitAction) {
                    let parsedExitAction = PVE.Parser.parsePropertyString(exitAction);
                    return Ext.htmlEncode(`${parsedExitAction.key}`);
                }
            },
        },
        {
            header: gettext('State'),
            width: 100,
            dataIndex: 'state',
            renderer: function (value, metaData, rec) {
                return PVE.Utils.render_sdn_pending_state(rec, value);
            },
        },
    ],
});
