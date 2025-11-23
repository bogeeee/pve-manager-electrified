/*
 * Base class for all the multitab config panels
 *
 * How to use this:
 *
 * You create a subclass of this, and then define your wanted tabs
 * as items like this:
 *
 * items: [{
 *  title: "myTitle",
 *  xytpe: "somextype",
 *  iconCls: 'fa fa-icon',
 *  groups: ['somegroup'],
 *  expandedOnInit: true,
 *  itemId: 'someId'
 * }]
 *
 * this has to be in the declarative syntax, else we
 * cannot save them for later
 * (so no Ext.create or Ext.apply of an item in the subclass)
 *
 * the groups array expects the itemids of the items
 * which are the parents, which have to come before they
 * are used
 *
 * if you want following the tree:
 *
 * Option1
 * Option2
 *   -> SubOption1
 *	-> SubSubOption1
 *
 * the suboption1 group array has to look like this:
 * groups: ['itemid-of-option2']
 *
 * and of subsuboption1:
 * groups: ['itemid-of-option2', 'itemid-of-suboption1']
 *
 * setting the expandedOnInit determines if the item/group is expanded
 * initially (false by default)
 */
Ext.define('PVE.panel.Config', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pvePanelConfig',

    showSearch: true, // add a resource grid with a search button as first tab
    viewFilter: undefined, // a filter to pass to that resource grid

    tbarSpacing: true, // if true, adds a spacer after the title in tbar

    dockedItems: [
        {
            // this is needed for the overflow handler
            xtype: 'toolbar',
            overflowHandler: 'scroller',
            dock: 'left',
            style: {
                padding: 0,
                margin: 0,
            },
            cls: 'pve-toolbar-bg',
            items: {
                xtype: 'treelist',
                itemId: 'menu',
                ui: 'pve-nav',
                expanderOnly: true,
                expanderFirst: false,
                animation: false,
                singleExpand: false,
                listeners: {
                    selectionchange: function (treeList, selection) {
                        if (!selection) {
                            return;
                        }
                        let view = this.up('panel');
                        view.suspendLayout = true;
                        view.activateCard(selection.data.id);
                        view.suspendLayout = false;
                        view.updateLayout();
                    },
                    itemclick: function (treelist, info) {
                        var olditem = treelist.getSelection();
                        var newitem = info.node;

                        // when clicking on the expand arrow, we don't select items, but still want the original behaviour
                        if (info.select === false) {
                            return;
                        }

                        // click on a different, open item then leave it open, else toggle the clicked item
                        if (olditem.data.id !== newitem.data.id && newitem.data.expanded === true) {
                            info.toggle = false;
                        } else {
                            info.toggle = true;
                        }
                    },
                },
            },
        },
        {
            xtype: 'toolbar',
            itemId: 'toolbar',
            dock: 'top',
            height: 36,
            overflowHandler: 'scroller',
        },
    ],

    firstItem: '',
    layout: 'card',
    border: 0,

    // used for automated test
    selectById: function (cardid) {
        var me = this;

        var root = me.store.getRoot();
        var selection = root.findChild('id', cardid, true);

        if (selection) {
            selection.expand();
            let menu = me.down('#menu');
            menu.setSelection(selection);
            return cardid;
        }
        return '';
    },

    activateCard: function (cardid) {
        var me = this;
        if (me.savedItems[cardid]) {
            let curcard = me.getLayout().getActiveItem();
            let newcard = me.add(me.savedItems[cardid]);
            me.helpButton.setOnlineHelp(newcard.onlineHelp || me.onlineHelp);
            if (curcard) {
                me.setActiveItem(cardid);
                me.remove(curcard, true);

                // trigger state change

                let ncard = cardid;
                // Note: '' is alias for first tab.
                // First tab can be 'search' or something else
                if (cardid === me.firstItem) {
                    ncard = '';
                }
                if (me.hstateid) {
                    me.sp.set(me.hstateid, { value: ncard });
                }
            }
        }
    },

    initComponent: function () {
        var me = this;

        var stateid = me.hstateid;

        me.sp = Ext.state.Manager.getProvider();

        var activeTab; // leaving this undefined means items[0] will be the default tab

        if (stateid) {
            let state = me.sp.get(stateid);
            if (state && state.value) {
                // if this tab does not exist, it chooses the first
                activeTab = state.value;
            }
        }

        // get title
        var title = me.title || me.pveSelNode.data.text;
        me.title = undefined;

        // create toolbar
        var tbar = me.tbar || [];
        me.tbar = undefined;

        if (!me.onlineHelp) {
            // use the onlineHelp property indirection to enforce checking reference validity
            let typeToOnlineHelp = {
                'type/lxc': { onlineHelp: 'chapter_pct' },
                'type/node': { onlineHelp: 'chapter_system_administration' },
                'type/pool': { onlineHelp: 'pveum_pools' },
                'type/qemu': { onlineHelp: 'chapter_virtual_machines' },
                'type/sdn': { onlineHelp: 'chapter_pvesdn' },
                'type/storage': { onlineHelp: 'chapter_storage' },
            };
            me.onlineHelp = typeToOnlineHelp[me.pveSelNode.data.id]?.onlineHelp;
        }

        if (me.tbarSpacing) {
            tbar.unshift('->');
        }
        tbar.unshift({
            xtype: 'tbtext',
            text: title,
            baseCls: 'x-panel-header-text',
        });

        me.helpButton = Ext.create('Proxmox.button.Help', {
            hidden: false,
            listenToGlobalEvent: false,
            onlineHelp: me.onlineHelp || undefined,
        });

        tbar.push(me.helpButton);

        me.dockedItems[1].items = tbar;

        // include search tab
        me.items = me.items || [];
        if (me.showSearch) {
            me.items.unshift({
                xtype: 'pveResourceGrid',
                itemId: 'search',
                title: gettext('Search'),
                iconCls: 'fa fa-search',
                pveSelNode: me.pveSelNode,
            });
        }

        me.savedItems = {};
        if (me.items[0]) {
            me.firstItem = me.items[0].itemId;
        }

        me.store = Ext.create('Ext.data.TreeStore', {
            root: {
                expanded: true,
            },
        });
        var root = me.store.getRoot();
        me.insertNodes(me.items);

        delete me.items;
        me.defaults = me.defaults || {};
        Ext.apply(me.defaults, {
            pveSelNode: me.pveSelNode,
            viewFilter: me.viewFilter,
            workspace: me.workspace,
            border: 0,
        });

        me.callParent();

        var menu = me.down('#menu');
        var selection = root.findChild('id', activeTab, true) || root.firstChild;
        var node = selection;
        while (node !== root) {
            node.expand();
            node = node.parentNode;
        }
        menu.setStore(me.store);
        menu.setSelection(selection);

        // on a state change,
        // select the new item
        var statechange = function (sp, key, state) {
            // it the state change is for this panel
            if (stateid && key === stateid && state) {
                // get active item
                let acard = me.getLayout().getActiveItem().itemId;
                // get the itemid of the new value
                let ncard = state.value || me.firstItem;
                if (ncard && acard !== ncard) {
                    // select the chosen item
                    menu.setSelection(root.findChild('id', ncard, true) || root.firstChild);
                }
            }
        };

        if (stateid) {
            me.mon(me.sp, 'statechange', statechange);
        }
    },

    insertNodes: function (items) {
        var me = this;
        var root = me.store.getRoot();

        items.forEach(function (item) {
            var treeitem = Ext.create('Ext.data.TreeModel', {
                id: item.itemId,
                text: item.title,
                iconCls: item.iconCls,
                leaf: true,
                expanded: item.expandedOnInit,
            });
            item.header = false;
            if (me.savedItems[item.itemId] !== undefined) {
                throw 'itemId already exists, please use another';
            }
            me.savedItems[item.itemId] = item;

            var group;
            var curnode = root;

            // get/create the group items
            while (Ext.isArray(item.groups) && item.groups.length > 0) {
                group = item.groups.shift();

                let child = curnode.findChild('id', group);
                if (child === null) {
                    // did not find the group item
                    // so add it where we are
                    break;
                }
                curnode = child;
            }

            // insert the item

            // lets see if it already exists
            var node = curnode.findChild('id', item.itemId);

            if (node === null) {
                curnode.appendChild(treeitem);
            } else {
                // should not happen!
                throw 'id already exists';
            }
        });
    },
});
