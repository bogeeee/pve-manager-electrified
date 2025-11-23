Ext.define('PVE.tree.ResourceMapTree', {
    extend: 'Ext.tree.Panel',
    alias: 'widget.pveResourceMapTree',
    mixins: ['Proxmox.Mixin.CBind'],

    rootVisible: false,

    emptyText: gettext('No Mapping found'),

    // will be opened on edit
    editWindowClass: undefined,

    // The base url of the resource
    baseUrl: undefined,

    // icon class to show on the entries
    mapIconCls: undefined,

    // if given, should be a function that takes a nodename and returns
    // the url for getting the data to check the status
    getStatusCheckUrl: undefined,

    // the result of above api call and the nodename is passed and can set the status
    checkValidity: undefined,

    // the property that denotes a single map entry for a node
    entryIdProperty: undefined,

    cbindData: function (initialConfig) {
        let me = this;
        const caps = Ext.state.Manager.get('GuiCap');
        me.canConfigure = !!caps.mapping['Mapping.Modify'];

        return {};
    },

    controller: {
        xclass: 'Ext.app.ViewController',

        addMapping: function () {
            let me = this;
            let view = me.getView();
            Ext.create(view.editWindowClass, {
                url: view.baseUrl,
                autoShow: true,
                listeners: {
                    destroy: () => me.load(),
                },
            });
        },

        add: function (_grid, _rI, _cI, _item, _e, rec) {
            let me = this;
            if (rec.data.type !== 'entry') {
                return;
            }

            me.openMapEditWindow(rec.data.name);
        },

        editDblClick: function () {
            let me = this;
            let view = me.getView();
            let selection = view.getSelection();
            if (!selection || selection.length < 1) {
                return;
            }

            me.edit(selection[0]);
        },

        editAction: function (_grid, _rI, _cI, _item, _e, rec) {
            this.edit(rec);
        },

        edit: function (rec) {
            let me = this;
            if (rec.data.type === 'map') {
                return;
            }

            me.openMapEditWindow(rec.data.name, rec.data.node, rec.data.type === 'entry');
        },

        openMapEditWindow: function (name, nodename, entryOnly) {
            let me = this;
            let view = me.getView();

            Ext.create(view.editWindowClass, {
                url: `${view.baseUrl}/${name}`,
                autoShow: true,
                autoLoad: true,
                entryOnly,
                nodename,
                name,
                listeners: {
                    destroy: () => me.load(),
                },
            });
        },

        remove: function (_grid, _rI, _cI, _item, _e, rec) {
            let me = this;
            let msg, id;
            let view = me.getView();
            let confirmMsg;
            switch (rec.data.type) {
                case 'entry':
                    msg = gettext("Are you sure you want to remove '{0}'");
                    confirmMsg = Ext.String.format(msg, rec.data.name);
                    break;
                case 'node':
                    msg = gettext("Are you sure you want to remove '{0}' entries for '{1}'");
                    confirmMsg = Ext.String.format(msg, rec.data.node, rec.data.name);
                    break;
                case 'map':
                    msg = gettext("Are you sure you want to remove '{0}' on '{1}' for '{2}'");
                    id = rec.data[view.entryIdProperty];
                    confirmMsg = Ext.String.format(msg, id, rec.data.node, rec.data.name);
                    break;
                default:
                    throw 'invalid type';
            }
            Ext.Msg.confirm(gettext('Confirm'), confirmMsg, function (btn) {
                if (btn === 'yes') {
                    me.executeRemove(rec.data);
                }
            });
        },

        executeRemove: function (data) {
            let me = this;
            let view = me.getView();

            let url = `${view.baseUrl}/${data.name}`;
            let method = 'PUT';
            let params = {
                digest: me.lookup[data.name].digest,
            };
            let map = me.lookup[data.name].map;
            switch (data.type) {
                case 'entry':
                    method = 'DELETE';
                    params = undefined;
                    break;
                case 'node':
                    params.map = PVE.Parser.filterPropertyStringList(
                        map,
                        (e) => e.node !== data.node,
                    );
                    break;
                case 'map':
                    params.map = PVE.Parser.filterPropertyStringList(map, (e) =>
                        Object.entries(e).some(([key, value]) => data[key] !== value),
                    );
                    break;
                default:
                    throw 'invalid type';
            }
            if (!params?.map.length) {
                method = 'DELETE';
                params = undefined;
            }
            Proxmox.Utils.API2Request({
                url,
                method,
                params,
                success: function () {
                    me.load();
                },
            });
        },

        load: function () {
            let me = this;
            let view = me.getView();
            Proxmox.Utils.API2Request({
                url: view.baseUrl,
                method: 'GET',
                failure: (response) => Ext.Msg.alert(gettext('Error'), response.htmlStatus),
                success: function ({ result: { data } }) {
                    let lookup = {};
                    data.forEach((entry) => {
                        lookup[entry.id] = Ext.apply({}, entry);
                        entry.iconCls = 'fa fa-fw fa-folder-o';
                        entry.name = entry.id;
                        entry.text = entry.id;
                        entry.type = 'entry';

                        let nodes = {};
                        for (const map of entry.map) {
                            let parsed = PVE.Parser.parsePropertyString(map);
                            parsed.iconCls = view.mapIconCls;
                            parsed.leaf = true;
                            parsed.name = entry.id;
                            parsed.text = parsed[view.entryIdProperty];
                            parsed.type = 'map';

                            if (nodes[parsed.node] === undefined) {
                                nodes[parsed.node] = {
                                    children: [],
                                    expanded: true,
                                    iconCls: 'fa fa-fw fa-building-o',
                                    leaf: false,
                                    name: entry.id,
                                    node: parsed.node,
                                    text: parsed.node,
                                    type: 'node',
                                };
                            }
                            nodes[parsed.node].children.push(parsed);
                        }
                        delete entry.id;
                        entry.children = Object.values(nodes);
                        entry.leaf = entry.children.length === 0;
                    });
                    me.lookup = lookup;
                    if (view.getStatusCheckUrl !== undefined && view.checkValidity !== undefined) {
                        me.loadStatusData();
                    }
                    view.setRootNode({
                        children: data,
                    });
                    let root = view.getRootNode();
                    root.expand();
                    root.childNodes.forEach((node) => node.expand());
                },
            });
        },

        nodeLoadingState: {},

        loadStatusData: function () {
            let me = this;
            let view = me.getView();
            PVE.data.ResourceStore.getNodes().forEach(({ node }) => {
                me.nodeLoadingState[node] = true;
                let url = view.getStatusCheckUrl(node);
                Proxmox.Utils.API2Request({
                    url,
                    method: 'GET',
                    failure: function (response) {
                        me.nodeLoadingState[node] = false;
                        view.getRootNode()?.cascade(function (rec) {
                            if (rec.data.node !== node) {
                                return;
                            }

                            rec.set('valid', 0);
                            rec.set('errmsg', response.htmlStatus);
                            rec.commit();
                        });
                    },
                    success: function ({ result: { data } }) {
                        me.nodeLoadingState[node] = false;
                        view.checkValidity(data, node);
                    },
                });
            });
        },

        renderStatus: function (value, _metadata, record) {
            let me = this;
            if (record.data.type !== 'map') {
                return '';
            }
            let iconCls;
            let status;
            if (value === undefined) {
                if (me.nodeLoadingState[record.data.node]) {
                    iconCls = 'fa-spinner fa-spin';
                    status = gettext('Loading...');
                } else {
                    iconCls = 'fa-question-circle';
                    status = gettext('Unknown Node');
                }
            } else {
                let state = value ? 'good' : 'critical';
                iconCls = PVE.Utils.get_health_icon(state, true);
                status = value
                    ? gettext('Mapping matches host data')
                    : record.data.errmsg || Proxmox.Utils.unknownText;
            }
            return `<i class="fa ${iconCls}"></i> ${status}`;
        },

        getAddClass: function (v, mD, rec) {
            let cls = 'fa fa-plus-circle';
            if (
                rec.data.type !== 'entry' ||
                rec.data.children?.length >= PVE.data.ResourceStore.getNodes().length
            ) {
                cls += ' pmx-action-hidden';
            }
            return cls;
        },

        isAddDisabled: function (v, r, c, i, rec) {
            return (
                rec.data.type !== 'entry' ||
                rec.data.children?.length >= PVE.data.ResourceStore.getNodes().length
            );
        },

        init: function (view) {
            let me = this;

            ['editWindowClass', 'baseUrl', 'mapIconCls', 'entryIdProperty'].forEach((property) => {
                if (view[property] === undefined) {
                    throw `No ${property} defined`;
                }
            });

            me.load();
        },
    },

    store: {
        sorters: 'text',
        data: {},
    },

    tbar: [
        {
            text: gettext('Add'),
            handler: 'addMapping',
            cbind: {
                disabled: '{!canConfigure}',
            },
        },
    ],

    listeners: {
        itemdblclick: 'editDblClick',
    },

    initComponent: function () {
        let me = this;

        let columns = [...me.columns];
        columns.splice(1, 0, {
            xtype: 'actioncolumn',
            text: gettext('Actions'),
            width: 80,
            items: [
                {
                    getTip: (v, m, { data }) =>
                        Ext.String.format(gettext("Add new host mapping for '{0}'"), data.name),
                    getClass: 'getAddClass',
                    isActionDisabled: 'isAddDisabled',
                    handler: 'add',
                },
                {
                    iconCls: 'fa fa-pencil',
                    getTip: (v, m, { data }) =>
                        data.type === 'entry'
                            ? Ext.String.format(gettext("Edit Mapping '{0}'"), data.name)
                            : Ext.String.format(
                                  gettext("Edit Mapping '{0}' for '{1}'"),
                                  data.name,
                                  data.node,
                              ),
                    getClass: (v, m, { data }) =>
                        data.type !== 'map' ? 'fa fa-pencil' : 'pmx-hidden',
                    isActionDisabled: (v, r, c, i, rec) => rec.data.type === 'map',
                    handler: 'editAction',
                },
                {
                    iconCls: 'fa fa-trash-o',
                    getTip: (v, m, { data }) =>
                        data.type === 'entry'
                            ? Ext.String.format(gettext("Remove '{0}'"), data.name)
                            : data.type === 'node'
                              ? Ext.String.format(gettext("Remove mapping for '{0}'"), data.node)
                              : Ext.String.format(gettext("Remove mapping '{0}'"), data.path),
                    handler: 'remove',
                },
            ],
        });
        me.columns = columns;

        me.callParent();
    },
});
